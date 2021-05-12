import PopulatingChache from "../src/PopulatingCache"

test("PUT a value into the cache and GET it back", () => {
	const alwaysReject = jest.fn(() =>
		Promise.reject(new Error("Should not be called"))
	)
	const cache = new PopulatingChache({fetchFunc: alwaysReject})
	const key = "key"
	const value = "value"
	cache.put(key, value)
	//console.log("cache after PUT", JSON.stringify(cache.getCacheData(), null, 2))
	//console.log("metadata after PUT",	JSON.stringify(cache.getMetadata(), null, 2))
	return cache.get(key).then((returnedValue) => {
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(value)
	})
})

/**
 * Test basic PUT and parsing of path
 */
test.each([
	["keyOne", "value1"],
	["parentKey.childKey", "value2"],
	[{ onlyObject: 222}, {_id: 222, foo: "bar"}],
	[[{ keyTwo: 3 }], { _id: 3, foo: "barbar" }],
	[["key1", { keyWithId: 4 }, { secondKeyWithId: 3 }, "childAttr"], "value4"],
	[["arrayOne[3]", { subkey: "stringkey" }, "childKey2/12", "var"], "value5"],
])("PUT and GET: %j = %j", (path, value) => {
	const alwaysReject = jest.fn(() => Promise.reject(new Error("Should not be called")))
	const cache = new PopulatingChache({fetchFunc: alwaysReject})
	cache.put(path, value)
	return cache.get(path).then((returnedValue) => {
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(value)
	})
})

/* eslint-disable jest/no-commented-out-tests */
/*
 * Test some edge cases. These actually are wrong usages of populating-cache.
 * But the cache is clever enough to correct these as good as possible.
 * 
 * This test outputs a warning on the console. Therefore we skip it.

  Currently deactivated to prevent the warning when releasing.

test("PUT automatically adds ID when its missing and warns on console", () => {
	let path =  ["missingId/98"]
	let value = { foo: "plainString" }
	let expectedValue = { _id: 98, foo: "plainString" }
	const alwaysReject = jest.fn(() => Promise.reject(new Error("Should not be called")))
	const cache = new PopulatingChache({fetchFunc: alwaysReject})
	cache.put(path, value)
	return cache.get(path).then((returnedValue) => {
		expect(alwaysReject.mock.calls.length).toBe(0)
		expect(returnedValue).toEqual(expectedValue)
	})
})
*/

test("PUT throws error on ID mismatch", () => {
	const cache = new PopulatingChache()
	expect(() => {
		cache.put("wrongId/99", {_id: 66, text: "Wrong id because 66 !== 99"})
	}).toThrow()
})


test("GET of unknown value should call backend", () => {
	const value = "valueFromServer"
	const fetchFunc = jest.fn(() => Promise.resolve(value))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	const path = ["justAnyKey"]
	return cache.get(path).then((returnedValue) => {
		expect(fetchFunc.mock.calls.length).toBe(1)
		expect(returnedValue).toBe(value)
	})
})

test("Populate a path", async () => {
	// GIVEN
	const fetchFunc = jest.fn(() =>
		Promise.reject(new Error("Backend should not be called in this test case"))
	)
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(["posts/11", "comments[0]"], {
		_id: 4711,
		text: "this is a comment",
		createdBy: { $refPath: "users/abc67" },
	})
	cache.put(["users/abc67"], {
		_id: "abc67",
		username: "SomeUser",
		email: "someuser@domain.com",
	})
	// console.log("=== Cache after PUTs", JSON.stringify(cache.getCacheData(), null, 4))
	// WHEN
	return cache.get(["posts/11", "comments[0]", "createdBy", "email"])
		// THEN
		.then(res => {
			expect(res).toBe("someuser@domain.com")
		})
})

test("Populate several references", async () => {
	// GIVEN a cache with DBrefs
	const fetchFunc = jest.fn((path) =>
		Promise.reject(new Error("Backend should not be called in this test case: "+JSON.stringify(path)))
	)
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(["comments[]"], {
		text: "this is a comment",
		createdBy: { $refPath: "users/u1" },
	})
	cache.put(["comments[]"], {
		text: "this is another comment",
		createdBy: { $refPath: "users/u2" },
	})
	cache.put(["users/u1"], {
		_id: "u1",
		username: "SomeUser",
		email: "someuser@domain.com",
	})
	cache.put(["users/u2"], {
		_id: "u2",
		username: "Second User",
		email: "user_u2@domain.com",
	})
	
	// WHEN we populate these DBrefs
	let comments = await cache.get("comments")
	//console.log("=== comments", JSON.stringify(comments, null, 2))
	let populatedComments = await cache.populate(comments, "createdBy")
	//console.log("=== populatedComments", JSON.stringify(comments, null, 2))
	
	// THEN the references are resolved and filled with users
	expect(populatedComments[0].createdBy.email).toBe("someuser@domain.com")
	expect(populatedComments[1].createdBy.email).toBe("user_u2@domain.com")
})


test("TTL is checked correctly, when populating a path", async () => {
	// GIVEN a post's comment that references a User
	const commentPath = [{posts:11}, "comments[0]"]
	const comment = {
		_id: 4711,
		text: "this is a comment",
		createdBy: { $refPath: "users/abc67" },
	}
	const emailPath   = ["posts/11", "comments[0]", "createdBy", "email"]
	const userEmail   = "someuser@domain.com"
	const fetchFunc = jest.fn((path) => {
		if (path.length === commentPath.length) return Promise.resolve(comment)
		else return Promise.resolve("This should not have been called with path="+JSON.stringify(path))
	})
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(commentPath, comment)
	cache.put(["users/abc67"], {
		_id: "abc67",
		username: "SomeUser",
		email: userEmail,
	})

	// AND the comment's TTL is expired
	let commentMetadata = cache.getMetadata(commentPath)
	commentMetadata.ttl = 1

	// WHEN we fetch the createdBy.email
	const res = await cache.get(emailPath)
	
	// THEN the comment is fetched from the backend. (not the user!)
	expect(res).toBe("someuser@domain.com")
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toStrictEqual(commentPath) // first argument of first call should be this
})


test("Force call to backend", async () => {
	const path = ["fooKey"]
	const value = { _id: 42, text: "this is comment 42" }
	const fetchFunc = jest.fn(() => Promise.resolve(value))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(path, value)

	// GET without force should not call the backend
	const res1 = await cache.get(path)
	expect(res1).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(0)

	// GET with force = true should call backend
	const res2 = await cache.get(path, {callBackend: cache.FORCE_BACKEND_CALL})
	expect(res2).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toEqual(path) // first argument of first call should be path
})

test("Check if value is already in cache", async () => {
	// GIVEN a value in the cache
	const path = ["parentKey", "childKey"]
	const value = "bar"
	const fetchFunc = jest.fn(() => Promise.reject("Should not be called. Only check if value is in cache."))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(path, value)

	// WHEN we check if that value is in the cache
	const res1 = await cache.isInCache(path)

	// THEN this is true AND backend has not been called
	expect(res1).toEqual(true)
	expect(fetchFunc.mock.calls.length).toBe(0)

	// WHEN we delete that value
	cache.delete(path)

	// THEN is is not in the cache anymore
	const res2 = await cache.isInCache(path)
	expect(res2).toEqual(false)
	expect(fetchFunc.mock.calls.length).toBe(0)
})

test("Get a value synchronously", async () => {
	// GIVEN a value in the cache
	const path = ["parentKey", "childKey"]
	const value = "bar"
	const nothingHerePath = ["nothingHere"]
	const fetchFunc = jest.fn(() => Promise.reject("Should not be called. Only check if value is in cache."))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(path, value)

	// WHEN get a value sync.
	const res = cache.getSync(path)
	// THEN the value is returned
	expect(res).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(0)

	// WHEN we try to get a value that is not in the cache
	let res2 = cache.getSync(nothingHerePath)
	// THEN undefined is returned
	expect(res2).toBe(undefined)
	expect(fetchFunc.mock.calls.length).toBe(0)
	
	// WHEN a value is expired
	const metadata = cache.getMetadata(path)
	metadata.ttl = 1
	// THEN getSync() can throw
	expect(() => {
		cache.getSync(path, {}, true)
	}).toThrow("expired")
})

test("Expired elements should be fetched from the backend", async () => {
	const path = ["fooKey"]
	const value = { _id: 43, text: "this is comment 43" }
	const valueNew = { _id: 43, text: "this is updated comment 43" }
	const fetchFunc = jest.fn(() => Promise.resolve(valueNew))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(path, value)

	// First call: Should be returned from the cache
	const res = await cache.get(path)
	expect(res).toEqual(value)
	expect(fetchFunc.mock.calls.length).toBe(0)

	// Set TTL to way in the past
	const metadata = cache.getMetadata(path)
	metadata.ttl = 1

	// Second call should be fetched from the backend
	const res2 = await cache.get(path)
	expect(res2).toEqual(valueNew)
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toEqual(path) // first argument of first call should be path
})

test("Element with expired parent should be fetched from the backend", async () => {
	const postPath = [{posts:11}]
	const commentTextPath = [{posts:11}, "comments[0]", "text"]
	const postValue = { _id:11, comments: [{ _id: 4711, text: "This is a comment" }] }
	const commentNewValue = "This is an updated comment"
	const postValueNew = { _id:11, comments: [{ _id: 4711, text: commentNewValue }] }

	// This mock backend returns the updated post. 
	// It only returns that one specific post and should not be called otherwise within this test case
	const fetchFunc = jest.fn((path) => {
		//console.log("Call to mock backend for GET("+JSON.stringify(value)+")")
		if (path.length === 1 && path[0].posts === 11) {
			return Promise.resolve(postValueNew)
		} else {
			return Promise.reject("Invalid call to backend with path="+JSON.stringify(path))
		}
	})
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(postPath, postValue)

	// First call: Should be returned from the cache
	const res = await cache.get(commentTextPath)
	expect(res).toEqual("This is a comment")
	expect(fetchFunc.mock.calls.length).toBe(0)

	// Set TTL to way in the past
	const metadata = cache.getMetadata(postPath)
	metadata.ttl = 1

	// Second call should be fetched from the backend
	const res2 = await cache.get(commentTextPath)
	expect(res2).toEqual(commentNewValue)
	expect(fetchFunc.mock.calls.length).toBe(1)
	expect(fetchFunc.mock.calls[0][0]).toEqual(postPath) // first argument of first (and only) call to fetchFunc should have been postPath
})

test("Delete all expired elems in the cache", async () => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in deleteExpiredElems test"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})

	//GIVEN
	cache.put("key1", "val1")
	cache.put("key2", "val2")

	//WHEN Set TTL of key2 to way in the past
	const metadata = cache.getMetadata("key2")
	metadata.ttl = 1
	// AND 
	cache.deleteExpiredElems()

	//THEN key1 should still be in the cache and key2 should be deleted
	let cacheData = cache.getCacheData()
	expect(cacheData["key1"]).toBe("val1")
	const res1 = await cache.get("key1")
	expect(res1).toEqual("val1")
	let isInCache = cache.isInCache("key2")
	expect(isInCache).toBe(false)
	expect(fetchFunc.mock.calls.length).toBe(0)
})


test("Merge properties", async () => {
	const fetchFunc = jest.fn(() => Promise.reject("Should not be called in merge properties test."))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	const path = "parent.child"
	cache.put(path, {foo: "bar"})
	cache.put(path, {key: "baz"}, {merge:true})

	let val = await cache.get(path)
	expect(val).toEqual({foo: "bar", key: "baz"})
})

test("Append to array", async () => {
	const fetchFunc = jest.fn(() => Promise.reject("Should not be called in append to array test."))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	const path = "parent.array[]"
	cache.put(path, "one")
	cache.put(path, "two")

	let val = await cache.get(["parent", "array[1]"])
	expect(val).toEqual("two")
})


/**
 * Test parsing of path and that fetchFunc is called with correct path
 */
test.each([
	["keyOne", "value1", "value2",  ["keyOne"]],
	["one.two.three", "value1", "value", ["one", "two", "three"]],
	["polls/ab3f-4d45", { _id: "ab3f-4d45", val:"Eins"}, { _id: "ab3f-4d45", val:"Zwei"}, [{polls: "ab3f-4d45"}]],  // alphanumeric ID
	["polls/4711", { _id: 4711, val:"Eins"}, { _id: 4711, val:"Zwei"}, [{polls: 4711}]],      // ID normalized to Number
	[[{polls: 4711}], { _id: 4711, val:"Eins"}, { _id: 4711, val:"Zwei"}, [{polls: 4711}]],   // numerical ID everywhere
])("Test correct param for fetchFunc: %j => %j", async (path, value, updatedValue, paramToFechFunc) => {
	//eslint-disable-next-line no-unused-vars
	const fetchFunc = jest.fn((pathArg) => Promise.resolve(updatedValue))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	cache.put(path, value)
	return cache.get(path, {callBackend: cache.FORCE_BACKEND_CALL}).then((returnedValue) => {
		expect(fetchFunc.mock.calls.length).toBe(1)
		expect(fetchFunc.mock.calls[0][0]).toStrictEqual(paramToFechFunc)   // deepEqual!
		expect(returnedValue).toEqual(updatedValue)
	})
})

/**
 * unit test for parsePath() function
 */
test.each([
	["abc",      [{key: "abc"}]],
	["$adfsf",   [{key: "$adfsf"}]],
	["abc[42]",  [{key: "abc", index: 42}]],
	["abc/4711", [{key: "abc", id: 4711}]],               // numerical ID
	["abc/abde-fa3d", [{key: "abc", id: "abde-fa3d"}]],   // alpha numerical ID
	[ { someObj: 4711 }, [{key: "someObj", id: 4711 }]],   // just one object as input
	[["abc", {foo:"bar"}], [{key: "abc"}, {key: "foo", id:"bar"}]],
	["parent.child/5a3f.three", [{key: "parent"}, {key: "child", id:"5a3f"}, {key: "three"}]],
	["one.array[]", [{key:"one"}, {key:"array", appendArray: true}]]
])("Test parsing of path %j into %j", (path, expectedResult) => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in parsePath test"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	const actual = cache.parsePath(path)
	expect(actual).toStrictEqual(expectedResult)
	expect(fetchFunc.mock.calls.length).toBe(0)
})

/**
 * Test listeners and change subscriptions
 */
test.each([
	// listenerPath, path, vaue, should listener be notified in this case
	["abc", "abc", "dummyValue", true],
	["ddd", "abc", "dummyValue", false],
	["comments", "comments/4711", {_id: 4711, text: "dummy comment"}, true],
	["comments/123", "comments/4711", {_id: 4711, text: "dummy comment"}, false],
	["myArray", "myArray[]", "append Array value", true],	
])("Test subscribe to PUT at path %j", (listenerPath, path, value, shouldBeNotified) => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in subsriptions"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	//GIVEN a subscribed listener
	//eslint-disable-next-line no-unused-vars
	const onPut = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe(listenerPath, onPut)
	
	// WHEN putting a value into the cache
	cache.put(path, value)
	
	// THEN listener should have been notified (if listener path matches)
	if (shouldBeNotified) {
		expect(onPut.mock.calls.length).toBe(1)
		expect(onPut.mock.calls[0][0]).toBe(path)
		expect(onPut.mock.calls[0][1]).toBe(value)
	} else {
		expect(onPut.mock.calls.length).toBe(0)
	}
})

test("Global listener receives all changes", () => {
	// GIVEN a cache
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in test for global listener"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	
	// AND a global listener
	//eslint-disable-next-line no-unused-vars
	const onPutGlobal = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("", onPutGlobal)

	// WHEN putting a values into the cache
	cache.put("one.two", "dummyValue")
	cache.put("three.four", "dummyValue2")
	
	// THEN global listener should have been notified for each PUT event
	expect(onPutGlobal.mock.calls.length).toBe(2)
	expect(onPutGlobal.mock.calls[0][0]).toBe("one.two")
	expect(onPutGlobal.mock.calls[0][1]).toBe("dummyValue")
	expect(onPutGlobal.mock.calls[1][0]).toBe("three.four")
	expect(onPutGlobal.mock.calls[1][1]).toBe("dummyValue2")
})

test("Subscription with path prefix", () => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in test for subscription with path prefix"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	
	// GIVEN a cache with some objects in it
	cache.put("one.two.three", "bar")
	
	// AND some listeners with different pathes
	//eslint-disable-next-line no-unused-vars
	const onPutTwo = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("one.two", onPutTwo)

	//eslint-disable-next-line no-unused-vars
	const onPutThree = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("one.two.three", onPutThree)

	// WHEN putting a new creator name into the cache
	cache.put("one.two.another", "dummyValue")
	
	// THEN listener on level two should have been called
	expect(onPutTwo.mock.calls.length).toBe(1)
	expect(onPutTwo.mock.calls[0][0]).toBe("one.two.another")
	expect(onPutTwo.mock.calls[0][1]).toBe("dummyValue")
  
	// AND listener on level three should not have been called
	expect(onPutThree.mock.calls.length).toBe(0)
})

test("Subscription with exact path", () => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in test for subscription with exact path"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	
	// GIVEN a cache 
	cache.put("one.two.three", "bar")
	
	// AND a listeners with an exact path
	//eslint-disable-next-line no-unused-vars
	const onPutExact = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("one.two", onPutExact, true)

	// WHEN putting a value BELOW the listeners exact path
	cache.put("one.two.three", "valueAtLevelThree")
	// THEN listener on level two should NOT have been called
	expect(onPutExact.mock.calls.length).toBe(0)
	
	// WHEN putting a value exactly at the listeners path
	cache.put("one.two", "valueAtLevelTwo")
	// THEN listener should have been called
	expect(onPutExact.mock.calls.length).toBe(1)
	expect(onPutExact.mock.calls[0][0]).toBe("one.two")
	expect(onPutExact.mock.calls[0][1]).toBe("valueAtLevelTwo")
})

test("More complex subscriptions", () => {
	const fetchFunc = jest.fn(() => Promise.reject("should not be called in test for complex subscriptions"))
	const cache = new PopulatingChache({fetchFunc: fetchFunc})
	
	// GIVEN a cache with some objects in it
	cache.put("foo", "bar")
	cache.put("posts[]", {_id: 101, text: "Just a post"})
	cache.put("posts[]", {_id: 102, text: "A second post"})
	let creatorPath = "posts/101.creator"
	cache.put(creatorPath, "Max")
	
	// AND some listeners with different pathes
	//eslint-disable-next-line no-unused-vars
	const onPutPost = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("posts", onPutPost)
	//eslint-disable-next-line no-unused-vars
	const onPutCreator = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("posts.creator", onPutCreator)
	//eslint-disable-next-line no-unused-vars
	const onPutFoo = jest.fn((path, value) => { /* value has been cached under path */ })
	cache.subscribe("foo", onPutFoo)
	
	// WHEN putting a new creator name into the cache
	cache.put(creatorPath, "Moritz")
	
	// THEN listener should have been notified
	expect(onPutPost.mock.calls.length).toBe(1)
	expect(onPutPost.mock.calls[0][0]).toBe(creatorPath)
	expect(onPutPost.mock.calls[0][1]).toBe("Moritz")

	expect(onPutCreator.mock.calls.length).toBe(1)
	expect(onPutCreator.mock.calls[0][0]).toBe(creatorPath)
	expect(onPutCreator.mock.calls[0][1]).toBe("Moritz")

	// AND foo listern should not yet have been called
	expect(onPutFoo.mock.calls.length).toBe(0)

	//WHEN putting a new foo value
	cache.put("foo", "bazz222")

	//THEN post listeners should not have any additional calls
	expect(onPutPost.mock.calls.length).toBe(1)  
	expect(onPutCreator.mock.calls.length).toBe(1)  // unchanged
	// AND foo listeners should now have been called
	expect(onPutFoo.mock.calls.length).toBe(1) 
	expect(onPutFoo.mock.calls[0][0]).toBe("foo")
	expect(onPutFoo.mock.calls[0][1]).toBe("bazz222")
})

