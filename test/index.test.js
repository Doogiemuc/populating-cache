import PopulatingChache from '../src/PopulatingCache.js'

test("PUT a value into the cache and GET it back", () => {
	const alwaysReject = jest.fn(() => Promise.reject("Should not be called"))
	let cache = new PopulatingChache(alwaysReject)
	let key   = "key"
	let value = "value"
	cache.put(key, value)
	return cache.get(key).then(returnedValue => {
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(value)
	})
})


test.each([
	[ "keyOne", "value1" ],
	[ [{keyTwo:3}], {_id:3, foo:"bar"} ],
	[ ["key1", {arrayKey:4}, {keyTwo:3}, "childKey"], "value2" ],
	[ ["arrayOne[3]", {subkey: "stringkey"}, "childKey2/12", "var"], "value4" ],
])("PUT and GET: %j = %j", (path, value) => {
	const alwaysReject = jest.fn(() => Promise.reject("Should not be called"))
	let cache = new PopulatingChache(alwaysReject)
	cache.put(path, value)
	console.log("cache after PUT", JSON.stringify(cache.getCacheData()))
	
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
	[ ["missingId/99"], "plainString", { _id:"99", value: "plainString" } ],	// not an object: Will wrap and add id
	[ ["wrongId/99"], {_id:666, foo:"bar"}, {_id:"99", foo:"bar"} ],					// id mismatch  => will correct internal id
	[ ["missingId/99"], "anything", {_id:"99", value:"anything"} ],						// no object => will automatically wrap and add id
])("PUT and GET: %j = %j", (path, value, expected) => {
	const alwaysReject = jest.fn(() => Promise.reject("Should not be called"))
	let cache = new PopulatingChache(alwaysReject)
	cache.put(path, value)
	console.log("cache after PUT", JSON.stringify(cache.getCacheData()))
	return cache.get(path).then(returnedValue => {
		console.log("cache returned:", returnedValue)
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(expected)
	})
})



test("GET of unkonw value should call backend", () => {
	let value = "valueFromServer"
	const fetchFunc = jest.fn(() => value)
	let cache = new PopulatingChache(fetchFunc)
	let path  = ["justAnyKey"]
	return cache.get(path).then(returnedValue => {
		expect(fetchFunc.mock.calls.length).toBe(1)
		expect(returnedValue).toBe(value)
	})
})




test.each([
		["abc",      {key:"key", value: "abc"}],
		["$adfsf",   {key:"key", value: "$adfsf"}],
		["abc[42]",  {key:"index", value: "42"}],
		["abc/4711", {key:"id", value: "4711"}],
	])("Test regex matching for path elements for (%s)", (str, tst) => 
{
	const re = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)(\[(?<index>\d+)\])?(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*))?$/
	let res = str.match(re)
	expect(res.groups)
	expect(res.groups[tst.key] === tst.value)
})