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
