import PopulatingCache from "../src/PopulatingCache"

/*
 * Tests for TTLs of collections and of their single elements.
 * Time is faked with a mocked Date.now(), TTL is 1 second.
 */

const TTL = 1000
let now

beforeEach(() => {
	now = 1000000
	jest.spyOn(Date, "now").mockImplementation(() => now)
})

afterEach(() => {
	jest.restoreAllMocks()
})

const advance = (ms) => { now += ms }

const polls = () => [
	{ _id: 5, title: "Poll five" },
	{ _id: 7, title: "Poll seven" },
]

/** A mock backend that serves the list under "polls" and single polls under "polls/<id>" */
const createBackend = (list = polls()) => jest.fn((path) => {
	if (path.length === 1 && path[0] === "polls") return Promise.resolve(list.map(p => ({ ...p, fresh: true })))
	if (path.length === 1 && path[0].polls !== undefined) {
		const poll = list.find(p => String(p._id) === String(path[0].polls))
		return Promise.resolve(poll ? { ...poll, fresh: true } : { _id: path[0].polls, notFound: true })
	}
	return Promise.reject(new Error("Unexpected backend call " + JSON.stringify(path)))
})

describe("Bugs in 5.7.0", () => {
	test("bug 1: GET of an uncached id calls the backend instead of returning the parent", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())

		const res = await cache.get("polls/99")

		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 99 }])
		expect(res).toEqual({ _id: 99, notFound: true })
	})

	test("bug 1: GET of an id under a key that is not cached at all calls the backend", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })

		const res = await cache.get("polls/5")

		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 5 }])
		expect(res.title).toBe("Poll five")
	})

	test("bug 2: an element expires together with its collection", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		advance(TTL + 1)

		const res = await cache.get("polls/5")

		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 5 }])
		expect(res.fresh).toBe(true)
	})

	test("bug 3: putting an element keeps the TTL of its collection (passes in 5.7.0 only by accident)", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		cache.put("polls/5", { _id: 5, title: "Poll five, updated" })
		advance(TTL + 1)

		const res = await cache.get("polls")

		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["polls"])
		expect(res.every(p => p.fresh)).toBe(true)
	})
})

describe("A collection has its own TTL and one per element", () => {
	test("put collection, then element: both TTLs survive", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		const listTtl = cache.getMetadata("polls").ttl
		advance(500)
		cache.put("polls/5", { _id: 5, title: "updated" })

		expect(cache.getMetadata("polls").ttl).toBe(listTtl)
		expect(cache.getMetadata("polls/5").ttl).toBe(listTtl + 500)
		expect(cache.getMetadata("polls/7").ttl).toBe(listTtl)
		expect(cache.getCacheData().polls).toHaveLength(2)
	})

	test("put element, then collection: both TTLs survive", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls/5", { _id: 5, title: "single" })
		expect(cache.getMetadata("polls").ttl).toBeUndefined()   // created without an own TTL
		advance(500)
		cache.put("polls", polls())

		const listTtl = cache.getMetadata("polls").ttl
		expect(listTtl).toBe(now + TTL)
		expect(cache.getMetadata("polls/5").ttl).toBe(listTtl)   // the newer list also refreshed poll 5
		expect(cache.getMetadata("polls")).toEqual({
			ttl: listTtl,
			type: "object",
			$elems: [
				{ _id: 5, ttl: listTtl, type: "object" },
				{ _id: 7, ttl: listTtl, type: "object" },
			],
		})
	})

	test("an element refreshed on its own outlives its collection", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		advance(600)
		cache.put("polls/5", { _id: 5, title: "Poll five, refreshed" })
		advance(600)   // list is expired, poll 5 is not

		const poll5 = await cache.get("polls/5")
		expect(poll5.title).toBe("Poll five, refreshed")
		expect(fetchFunc).toHaveBeenCalledTimes(0)

		const list = await cache.get("polls")
		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["polls"])
		expect(list.every(p => p.fresh)).toBe(true)
	})

	test("an element without an own entry falls back to the TTL of its collection", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		cache.put("polls/5", { _id: 5, title: "refreshed" })
		advance(TTL + 1)
		cache.put("polls/5", { _id: 5, title: "refreshed again" })

		// poll 7 only has the TTL of the list
		const poll7 = await cache.get("polls/7")
		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 7 }])
		expect(poll7.fresh).toBe(true)
		// and also when the metadata entry of an element is missing completely
		delete cache.getMetadata("polls").$elems[0].ttl
		expect(cache.isInCache("polls/5")).toBe(false)
	})

	test("a collection that was only built from single elements never expires (as in 5.7.0)", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls/5", { _id: 5, title: "single" })
		advance(TTL + 1)

		const list = await cache.get("polls")
		expect(fetchFunc).toHaveBeenCalledTimes(0)
		expect(list).toEqual([{ _id: 5, title: "single" }])
		expect(cache.isInCache("polls/5")).toBe(false)   // but its element did expire
	})

	test.each([
		["polls/9", "by id"],
		["polls[]", "by appending"],
	])("an element added after the list with put(%j) (%s) has its own TTL", async (path) => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		advance(600)
		cache.put(path, { _id: 9, title: "Poll nine" })
		advance(600)

		expect(cache.getCacheData().polls).toHaveLength(3)
		expect(cache.getMetadata("polls").$elems).toHaveLength(3)
		expect(await cache.get("polls/9")).toEqual({ _id: 9, title: "Poll nine" })
		expect(fetchFunc).toHaveBeenCalledTimes(0)
		expect(cache.isInCache("polls")).toBe(false)
		expect(cache.isInCache("polls/5")).toBe(false)
	})

	test("element by index: put('polls[1]') sets only that element's TTL", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		advance(600)
		cache.put("polls[1]", { _id: 7, title: "seven" })
		advance(600)
		expect(cache.isInCache("polls[1]")).toBe(true)
		expect(cache.isInCache("polls[0]")).toBe(false)
		expect(cache.isInCache("polls")).toBe(false)
	})

	test("deeper paths step into the metadata of the element", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		advance(100)
		cache.put("polls/5.proposals", [{ _id: 1, title: "prop" }])

		const listTtl = now - 100 + TTL
		expect(cache.getMetadata("polls").ttl).toBe(listTtl)
		expect(cache.getMetadata("polls/5")).toEqual({
			_id: 5,
			ttl: listTtl,
			type: "object",
			proposals: { ttl: now + TTL, type: "object", $elems: [{ _id: 1, ttl: now + TTL, type: "object" }] },
		})
		expect(cache.getMetadata("polls/5.proposals/1").ttl).toBe(now + TTL)
		expect(cache.getMetadata("polls/99")).toBeUndefined()
		expect(cache.getMetadata("nothing.here")).toBeUndefined()
	})

	test("put under an id or index throws when the cached value is not an array", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", { notAnArray: true })
		expect(() => cache.put("polls/5", { _id: 5 })).toThrow("not an array")
		expect(() => cache.put("polls[0]", { _id: 5 })).toThrow("not an array")
		expect(cache.getMetadata("polls")).toEqual({ ttl: now + TTL, type: "object" })
	})
})

describe("ids", () => {
	test("string and number ids are the same id: no duplicates", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", [{ _id: "5", title: "string id" }])
		cache.put("polls/5", { _id: "5", title: "updated" })   // parsePath turns "polls/5" into the number 5
		cache.put([{ polls: "5" }], { _id: 5, title: "updated again" })

		expect(cache.getCacheData().polls).toHaveLength(1)
		expect(cache.getMetadata("polls").$elems).toHaveLength(1)
		expect(await cache.get("polls/5")).toEqual({ _id: 5, title: "updated again" })
		expect(cache.getSync([{ polls: "5" }]).title).toBe("updated again")
		expect(cache.getMetadata("polls/5")).toBe(cache.getMetadata([{ polls: "5" }]))
		expect(fetchFunc).toHaveBeenCalledTimes(0)
	})

	test("id mismatch is still detected with mixed types", () => {
		const cache = new PopulatingCache()
		expect(() => cache.put("polls/5", { _id: "6" })).toThrow("ID mismatch")
		expect(() => cache.put("polls/5", { _id: "5" })).not.toThrow()
	})
})

describe("option fetchCollection", () => {
	test("an uncached element by index is fetched from the backend", async () => {
		const fetchFunc = jest.fn(() => Promise.resolve("from backend"))
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		expect(await cache.get("arr[0]")).toBe("from backend")
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["arr[0]"])
	})

	test("an uncached element is fetched on its own by default", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		await cache.get("polls/99")
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 99 }])
	})

	test("with fetchCollection a missing element is fetched with its collection", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })

		const poll = await cache.get("polls/7", { fetchCollection: true })

		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["polls"])
		expect(poll).toEqual({ _id: 7, title: "Poll seven", fresh: true })
		expect(cache.getCacheData().polls).toHaveLength(2)
		expect(cache.getMetadata("polls").ttl).toBe(now + TTL)
		// all other polls are now in the cache, too
		expect(await cache.get("polls/5", { fetchCollection: true })).toEqual({ _id: 5, title: "Poll five", fresh: true })
		expect(fetchFunc).toHaveBeenCalledTimes(1)
	})

	test("with fetchCollection an element that is not in the new list is undefined", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL, fetchCollection: true })  // also as config
		const poll = await cache.get("polls/99")
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["polls"])
		expect(poll).toBeUndefined()
	})

	test("with fetchCollection an expired element is refreshed with its collection", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL, fetchCollection: true })
		cache.put("polls", polls())
		advance(TTL + 1)

		const title = await cache.get("polls/5.title")
		expect(title).toBe("Poll five")
		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(["polls"])
		expect(cache.getCacheData().polls.every(p => p.fresh)).toBe(true)
	})

	test("fetchCollection rejects when the backend does not return an array", async () => {
		const fetchFunc = jest.fn(() => Promise.resolve({ not: "an array" }))
		const cache = new PopulatingCache({ fetchFunc, fetchCollection: true })
		await expect(cache.get("polls/5")).rejects.toThrow("did not return an array")
	})

	test("fetchCollection does not call the backend with DO_NOT_CALL_BACKEND", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, fetchCollection: true })
		expect(await cache.get("polls/5", { callBackend: cache.DO_NOT_CALL_BACKEND })).toBeUndefined()
		expect(fetchFunc).toHaveBeenCalledTimes(0)
	})
})

describe("callBackend options with collections", () => {
	test("DO_NOT_CALL_BACKEND resolves fresh and missing elements and rejects expired ones", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		const opts = { callBackend: cache.DO_NOT_CALL_BACKEND }
		cache.put("polls", polls())
		expect((await cache.get("polls/5", opts)).title).toBe("Poll five")
		expect(await cache.get("polls/99", opts)).toBeUndefined()
		advance(TTL + 1)
		await expect(cache.get("polls/5", opts)).rejects.toBeUndefined()
		await expect(cache.get("polls/5.title", opts)).rejects.toBeUndefined()
		expect(fetchFunc).toHaveBeenCalledTimes(0)
	})

	test("FORCE_BACKEND_CALL fetches a fresh element exactly once", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		const poll = await cache.get("polls/5", { callBackend: cache.FORCE_BACKEND_CALL })
		expect(poll.fresh).toBe(true)
		expect(fetchFunc).toHaveBeenCalledTimes(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 5 }])
	})

	test("populating a $refPath into an element of a collection uses the element's TTL", async () => {
		const fetchFunc = jest.fn((path) => Promise.resolve({ _id: "u1", name: "fetched " + JSON.stringify(path) }))
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("users", [{ _id: "u1", name: "Alice" }])
		cache.put("polls", [{ _id: 5, createdBy: { $refPath: "users/u1" } }])
		expect(await cache.get("polls/5.createdBy.name")).toBe("Alice")
		expect(fetchFunc).toHaveBeenCalledTimes(0)

		advance(600)
		cache.put("polls", [{ _id: 5, createdBy: { $refPath: "users/u1" } }])
		advance(600)   // users are expired, polls are not
		expect(await cache.get("polls/5.createdBy.name")).toBe('fetched [{"users":"u1"}]')
		expect(fetchFunc).toHaveBeenCalledTimes(1)
	})
})

describe("delete and deleteExpiredElems", () => {
	test("deleteExpiredElems removes only expired elements", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", [...polls(), { _id: 8, title: "eight" }])
		advance(600)
		cache.put("polls/5", { _id: 5, title: "refreshed" })
		cache.put("other", "fresh")
		advance(600)   // list and poll 7 and 8 are expired, poll 5 is not

		cache.deleteExpiredElems()

		expect(cache.getCacheData().polls).toEqual([{ _id: 5, title: "refreshed" }, undefined, undefined])
		expect(cache.getMetadata("polls").$elems).toEqual([{ _id: 5, ttl: now - 600 + TTL, type: "object" }, undefined, undefined])
		expect(cache.isInCache("polls/5")).toBe(true)
		expect(cache.isInCache("other")).toBe(true)

		advance(TTL)
		cache.deleteExpiredElems()
		expect(cache.getCacheData()).toEqual({})   // nothing fresh left in the collection => removed completely
		expect(cache.getMetadata()).toEqual({})
	})

	test("deleteExpiredElems keeps fresh collections and their elements", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		advance(600)
		cache.deleteExpiredElems()
		expect(cache.getCacheData().polls).toEqual(polls())
		expect(cache.getMetadata("polls").$elems).toHaveLength(2)
	})

	test("get after deleteExpiredElems fetches the deleted element", async () => {
		const fetchFunc = createBackend()
		const cache = new PopulatingCache({ fetchFunc, ttl: TTL })
		cache.put("polls", polls())
		advance(600)
		cache.put("polls/5", { _id: 5, title: "refreshed" })
		advance(600)
		cache.deleteExpiredElems()
		const poll7 = await cache.get("polls/7")
		expect(poll7.fresh).toBe(true)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual([{ polls: 7 }])
	})

	test("delete an element of a collection and an element by index", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		cache.delete("polls/5")
		expect(cache.getCacheData().polls).toEqual([undefined, { _id: 7, title: "Poll seven" }])
		expect(cache.getMetadata("polls").$elems[0]).toBeUndefined()
		expect(cache.isInCache("polls/5")).toBe(false)
		cache.delete("polls[1]")
		expect(cache.isInCache("polls/7")).toBe(false)
		expect(cache.getCacheData().polls).toHaveLength(2)
		cache.delete("polls")
		expect(cache.isInCache("polls")).toBe(false)
		expect(cache.getMetadata("polls")).toBeUndefined()
	})

	test("emptyCache clears data and metadata", () => {
		const cache = new PopulatingCache({ ttl: TTL })
		cache.put("polls", polls())
		cache.emptyCache()
		expect(cache.getCacheData()).toEqual({})
		expect(cache.getMetadata()).toEqual({})
	})
})
