import PopulatingChache from "../src/PopulatingCache"

test("PUT a value into the cache and GET it back", () => {
	const alwaysReject = jest.fn(() =>
		Promise.reject(new Error("Should not be called"))
	)
	const cache = new PopulatingChache(alwaysReject)
	const key = "key"
	const value = "value"
	cache.put(key, value)
	console.log(
		"cache after PUT",
		JSON.stringify(cache.getCacheData(), null, 2)
	)
	console.log(
		"metadata after PUT",
		JSON.stringify(cache.getMetadata(), null, 2)
	)
	return cache.get(key).then(returnedValue => {
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(value)
	})
})

test.each([
	["keyOne", "value1"],
	[[{ keyTwo: 3 }], { _id: 3, foo: "bar" }],
	[["key1", { keyWithId: 4 }, { secondKeyWithId: 3 }, "childAttr"], "value2"],
	[["arrayOne[3]", { subkey: "stringkey" }, "childKey2/12", "var"], "value4"]
])("PUT and GET: %j = %j", (path, value) => {
	const alwaysReject = jest.fn(() =>
		Promise.reject(new Error("Should not be called"))
	)
	const cache = new PopulatingChache(alwaysReject)
	cache.put(path, value)
	console.log("cache after PUT", JSON.stringify(cache.getCacheData()))
	console.log("metadata after PUT", JSON.stringify(cache.getMetadata()))
	return cache.get(path).then(returnedValue => {
		console.log("cache returned:", returnedValue)
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(value)
	})
})

/**
 * Test some edge cases. These actually are wrong usages of populating-cache.
 * But the cache is clever enough to correct these as good as possible.
 */
test.each([
	[["missingId/99"], "plainString", { _id: "99", value: "plainString" }], // not an object: Will wrap and add id
	[["wrongId/99"], { _id: 666, foo: "bar" }, { _id: "99", foo: "bar" }], // id mismatch  => will correct internal id
	[["missingId/99"], "anything", { _id: "99", value: "anything" }] // no object => will automatically wrap and add id
])("PUT and GET: %j = %j", (path, value, expected) => {
	const alwaysReject = jest.fn(() =>
		Promise.reject(new Error("Should not be called"))
	)
	const cache = new PopulatingChache(alwaysReject)
	cache.put(path, value)
	console.log("cache after PUT", JSON.stringify(cache.getCacheData()))
	console.log("metadata after PUT", JSON.stringify(cache.getMetadata()))
	return cache.get(path).then(returnedValue => {
		console.log("cache returned:", returnedValue)
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(expected)
	})
})

test("GET of unkonw value should call backend", () => {
	const value = "valueFromServer"
	const fetchFunc = jest.fn(() => Promise.resolve(value))
	const cache = new PopulatingChache(fetchFunc)
	const path = ["justAnyKey"]
	return cache.get(path).then(returnedValue => {
		expect(fetchFunc.mock.calls.length).toBe(1)
		expect(returnedValue).toBe(value)
	})
})

test("Populate a path", async () => {
	// GIVEN
	const fetchFunc = jest.fn(() =>
		Promise.reject(
			new Error("Backend should not be called in this test case")
		)
	)
	const cache = new PopulatingChache(fetchFunc)
	cache.put(["posts/11", "comments[0]"], {
		_id: 4711,
		text: "this is a comment",
		createdBy: { $refPath: "users/abc67" }
	})
	cache.put(["users/abc67"], {
		_id: "abc67",
		username: "SomeUser",
		email: "someuser@domain.com"
	})
	// console.log("=== Cache after PUTs", JSON.stringify(cache.getCacheData(), null, 4))
	// WHEN
	return cache
		.get(["posts/11", "comments[0]", "createdBy", "email"])
		.then(res => {
			// THEN
			expect(res).toBe("someuser@domain.com")
		})
})

test("Force = true should be fetched from the backend", async () => {
	const path = ["fooKey"]
	const value = { _id: 42, text: "this is a comment" }
	const fetchFunc = jest.fn(() => Promise.resolve(value))
	const cache = new PopulatingChache(fetchFunc)
	cache.put(path, value)

	// GET with force = true should call backend
	const res = await cache.get(path, true)
	expect(res).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toEqual(path) // first argument of first call should be path
})

test("Expired elements should be fetched from the backend", async () => {
	const path = ["fooKey"]
	const value = { _id: 42, text: "this is a comment" }
	const fetchFunc = jest.fn(() => Promise.resolve(value))
	const cache = new PopulatingChache(fetchFunc)
	cache.put(path, value)

	// First call: Should be returned from the cache
	const res = await cache.get(path)
	expect(res).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(0)

	// Set TTL to way in the past
	const metadata = cache.getMetadata()
	metadata[path].ttl = 5

	// Second call should be fetched from the backend
	const res2 = await cache.get(path)
	expect(res2).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toEqual(path) // first argument of first call should be path
})

/*
test.each([
		["abc",      {key:"key", value: "abc"}],
		["$adfsf",   {key:"key", value: "$adfsf"}],
		["abc[42]",  {key:"index", value: "42"}],
		["abc/4711", {key:"id", value: "4711"}],
	])("Test regex matching for path element '%s'", (str, tst) => 
{
	const re = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)(\[(?<index>\d+)\])?(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*))?$/
	let res = str.match(re)
	expect(res.groups)
	expect(res.groups[tst.key] === tst.value)
})
*/
