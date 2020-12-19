# Populating-Cache - JS client side cache

Efficient JavaScript client side cache. When data is fetched from a backend then it can be cached locally, for example in an App that's running on a mobile device.

[![Build Status](https://travis-ci.com/Doogiemuc/populating-cache.svg?branch=main)](https://travis-ci.com/Doogiemuc/populating-cache)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/Naereen/StrapDown.js/blob/master/LICENSE)
[![GitHub release](https://img.shields.io/github/release/Naereen/StrapDown.js.svg)](https://GitHub.com/Naereen/StrapDown.js/releases/)

## Features

 * On the client data is locally stored in an in-memory cache (which is a plain JavaScript object)
 * Values in the cache may be anything you can store in a JavaScript variable: Strings, Arrays or JSON Objects.
 * Every value you put into the cache can have a limited time to life. If that TTL expires, then the value will be refetched from the backend.
 * Populating-Cache is not just a simple key=value store. Values can be stored under any [path](#path-into-the-cache).
 * A value may reference other values in the cache via their path, e.g. `posts[42].createdBy` may reference a `user` entity. These Database references (DBref) can automatically be populated when getting values from the cache.
 * Populating cache is 100% tested and highly configurable.

## Simple usage

Install the npm dependency in your project: `npm install populating-cache`


#### helloWorld.js
```javascript
import PopulatingCache from 'populating-cache'  // the module exports a class

// When a value needs to be fetched from the backend then Populating-Cache will call 
// this function that you must provide.
let fetchFunc = function(path) {
	// [...] call backend, make REST request, etc.
	return Promise.resolve(valueFetchedFromBackend)
}

// Create a new cache intance.
let cache = new PopulatingCache(fetchFunc)

// PUT a value into the cache under a given key.
cache.put("someKey", "Just any value")

// GET that value back from the cache.
let value = await cache.get("someKey")

// get() will call the backend if the value under a key is expired or not in the cache at all.
// Therefore get() is an asynchrounous function. It returns a Promise.
// When a value is fetched from the backend, then it is cached automatically.
let valueFromBackend = await cache.get("key2")
```



## Populating cache is a tree structure

Many caches only store values under keys (or ids). `Populating-Cache` stores values in a tree structure. The cached elements in this tree are identified by the path from the root of the tree to that element.
The values that are stored in the cache (normally) sit at the leaves of this tree.


## Path into the cache

A `path` defines where a value will be stored in the cache. It is an array of path elements from the root of the cache to the value. A Path for example looks like this:

```javascript
cache.put(["keyOne"], val)                        // Just one string key on top level
cache.put(["parentKey", "childKey"], value)       // value will be stored under cache.parentKey.childKey
cache.put(["parentKey", "childArray[3]"], value)  // cache.parentKey.childArray[3] = value

// Populting-Cache can automatically find array items by their _id and store values under this item.
// Creator of comment with id "ef37d" in post with id "id42"
// (Here we store a user object in the cache.)
cache.put(["posts/id42", "comments/ef37d", "createdBy"], {_id:"d55e", name: "John Doe", email: "john@doe.com"}) 

// Path elements can also be objects. This results in the same path as the example above.
cache.put([{posts:"id42"}, {comments:"ef37d"}, "createdBy"], { ... })
```

Each path must have at least one element. Each path element can be

 * a plain string which will be used as key (ie. object attribute in the cache object)
 * name of an array and array-index in brackets: value will be stored in (or under) this array element
 * a string in the format `"key/id"`. Value will be stored under the array element with that `_id` (Name of "`_id`"-key can be configured)
 * or object `{key: id}`

When you call `put(path, value)` then the algorithm walks along `path` and stores `value` at the end of the path. All intermidate elements along the path (objects & arrays) will automatically be created. 

## Time to life (TTL)

When you `put` a value into the cache, then metadata about that value will also be stored. Each value can have a time to life after which it expires. When you try to `get` and expired value,
then it is be refetched from the backend. When a value is expired, then also its children are considered to be expired. (But not referenced entities. They have their own TTL.)

## Populate DB references (DBref)

The data returned by the backend my contain references to other entities. These references are inspired by [MongoDB DBrefs](https://docs.mongodb.com/manual/reference/database-references/#dbrefs) and the `populate()` function of the awesome [Mongoose](https://mongoosejs.com/docs/populate.html) lib.

When GET-ing a value from the cache, then DBrefs can automatically be resolved from within the cache content. Let's use the following content of a `populating-cache` as an example:

```javascript
cacheMetadata = {
	"posts": [
		{
			_id: 4711,
			text: "This is an example post"
			comments: [
				{ 
					_id: 101, 
					commentText: "This is a comment by user1", 
					createdBy: {				
						$refPath: "users/901"	// referenced `path` to other entity in cache
					}
				}
			]
		}
	],
	"users": [
		{	// This is the referenced user
			_id: 901,
			email: "user1@domain.com"
		},
	]
}
```

A simple list of `posts`. Each post can have `comments`. And each comment is `createdBy` a `user`. 
But the createdBy-user is not stored again and again for every comment. Instead, users are cached seperately under the top-level key `users`. Each comment then _references_ one user. The `$ref` attribute is the name of the top-level key. And `$id` is the \_id of the user under that key that created the comment.

When a path in a call to `get(path)` spans a DBref, then this ref is automatically resolved:

```javascript
	let path = [{posts:4711}, {comments: 101}, "createdBy", "email"]
	let result = cache.get(path)		
	// result is now "user1@domain.com"
```

When a DBref is resolved, then of course the TTL of the referenced target entity (in our example `user/901`) is taken into account. If that user's data in the cache is expired, then a query for that user will be sent to the backend. The response of the backend will be used to update the user data in the cache. The TTL in the metadata will be refreshed. And this updated data will be used to populate the DBref.

```javascript
cacheMetadata = {
	"posts": [...],
	"users": [
		{
			_id: 901,
			ttl: 1456  //  <= EXPIRED!
		},
		{
			_id: 902,
			ttl: 25263426457// +5 days
		},
	]
}
```

<div style="border: 1px solid #F99; padding: 5px">
Population does not change the DBref element. In the cache, the DBref will not be replaced by the referenced data. Only the value returned by `get(path)` will contain the resolved reference.
</div>

# API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

-   [PopulatingCache](#populatingcache)
    -   [Parameters](#parameters)
    -   [put](#put)
        -   [Parameters](#parameters-1)
    -   [get](#get)
        -   [Parameters](#parameters-2)
    -   [getOrFetch](#getorfetch)
        -   [Parameters](#parameters-3)
    -   [delete](#delete)
        -   [Parameters](#parameters-4)
    -   [getCacheData](#getcachedata)
    -   [getCacheMetadata](#getcachemetadata)
    -   [emptyCache](#emptycache)
    -   [expireOldTtls](#expireoldttls)
    -   [shouldCallBackend](#shouldcallbackend)
        -   [Parameters](#parameters-5)
    -   [path2rest](#path2rest)
        -   [Parameters](#parameters-6)

## PopulatingCache

Doogies unbelievably clever implementation of a client side cache.

    cache.get("cachedPrimitive")							// => 4711
    cache.get("posts")												// => Anything thats cached under object key "posts", e.g. the Array of posts
    cache.get(["posts", "category"])					// => returns this.cache.posts.category  (one value)
    cache.get(["usersById", "4711"])					// => the this.cache.userById["4711"]
    cache.get([{posts: 1}])											// <= the post with id 1 from the array of posts
    cache.get([{posts: 5}, {comments: "adfbe435d"}, "createdBy", "email"])		// walk the tree and populate all necessary references

### Parameters

-   `fetchFunc`  
-   `config`  

### put

Cache `value` under the given `path` in this cache. The value may then be retrieved back with a call to `get(path)`.
All intermediate objects along the path will be created in the cache if necessary.
Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured `defaultTTLms`.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** path under which the `value` shall be stored in the cache
-   `value` **Any** The value to store in the cache.
-   `ttl` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** time to live / how long value can be stored in the cache. Defaults to config.defaultTTLms (optional, default `this.config.defaultTTLms`)

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`

### get

Fetch a value from the cache. If the value isn't in the cache or if it is expired, then the backend will be queried for the value under `path`.
If `force==true` then the value will always be queried from the backend.
When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.

#### Parameters

-   `path`  array that forms the path to the value that shall be fetched. 
        Each array element can be one of three formats: 
          \- a plain "attributeName" for object properties in the cache.
          \- { arrayAttr: "abde3f"} for the array element with that id.
          \- "array[index]" for array elements. Index must be a positive. 
        For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
        For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
-   `force`  Force calls to backend, even when cache element is not yet expired (optional, default `false`)
-   `populate`  Automatically populate DBrefs from this cache if possible. (optional, default `true`)

Returns **any** (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.

### getOrFetch

This method decides if the backend needs to be called to fetch a given value.
The backend will be called, IF

-   cacheElem is null, ie. not yet in the cache
-   cacheElem is expired, because its metadata.ttl is in the past.
-   or when force === true

When the backend is call, then the returned value is PUT() back into the cache
with and updated TTL.

This method will only be called for leaf elements at the end of path. We never query for "in between" elements along a path.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** The full path to cacheElem
-   `cacheElem` **any** the leaf element at the end of path or null if not in the cache yet
-   `metadata` **any** metadata for cacheElem
-   `force` **any** always call backend if true

### delete

Delete an element from the cache. It's value will be set to undefined.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** path to the element that shall be deleted

### getCacheData

Get (a direct reference!) to all the data in the cache.
The cacheData is exactly as returned by `fetchFunc(path)`

### getCacheMetadata

While you `put` values into the cache, populating cache automatically
creates a second parallel tree of metadata next to the `cacheData`.
The metadata contains the time to life TTL for each leave element.

### emptyCache

Completely empty the cache. This also clears out all metadata.

### expireOldTtls

Recursively walk through the cacheData and delete all expired elements.
You MAY call this from time to time to optimize the cache's memory consumption

### shouldCallBackend

Check if we need to call the backend for this cacheElem.

-   If cacheElem is undefined or null then of course we must call the backend.
-   If cacheElem exists and is not the last elem in path (the leaf), then do NOT call the backend.
    We only call the backend for leafs in the path.
-   If cacheElem is expired, ie. its TTL is in the past, the call the backend.
-   Otherwise cacheElem exists and is not expired. Then call the backend depending on the `force` value.

#### Parameters

-   `i` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** Index in path
-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** Path along the tree of entities. The leaf of this path shall be fetched.
-   `force` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** Force call to backend. Skip the cache
-   `cacheElem`  
-   `metadata` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** subtree of this.cacheMetadata for element path[i]
-   `cache` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** subtree of this.cacheData for element path[i]

### path2rest

Convert the given path to a REST URL path.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** a populating-cache path array
