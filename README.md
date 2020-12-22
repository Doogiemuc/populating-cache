# Populating-Cache - JS client side cache

Efficient JavaScript client side cache. When data is fetched from a backend then it can be cached locally, for example for an App that's running on a mobile device.

[![Build Status](https://travis-ci.com/Doogiemuc/populating-cache.svg?branch=main)](https://travis-ci.com/Doogiemuc/populating-cache)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/Naereen/StrapDown.js/blob/master/LICENSE)
[![GitHub release](https://img.shields.io/github/release/Naereen/StrapDown.js.svg)](https://GitHub.com/Naereen/StrapDown.js/releases/)

## Features

-   Cache data is locally stored in an in-memory cache (which is a plain JavaScript object)
-   Values in the cache may be anything you can store in a JavaScript variable: Strings, Arrays or JSON Objects.
-   Every value you put into the cache can have a limited time to life. If that TTL expires, then the value will be refetched from the backend.
-   Populating-Cache is not just a simple key=value store. Values can be stored under any [path](#path-into-the-cache).
-   A value may reference other values in the cache via their path, e.g. `posts[42].createdBy` may reference a `User` entity. These database references (DBref) can automatically be populated when getting values from the cache.
-   Populating cache is 100% tested and highly configurable.

## Simple usage

Install the npm dependency in your project: `npm install populating-cache`

#### helloWorld.js

```javascript
import PopulatingCache from 'populating-cache'  // the module exports a class

/**
 * When a value needs to be fetched from the backend 
 * then populating-cache will call this function that you must provide.
 * @param {Array} path to the value that needs to be fetched,
 *                e.g. ["posts/ad4e-45fd", "comments"]
 * @return {Promise} value fetched from the backend
 */
let fetchFunc = function(path) {
  // [...] call backend, make REST request, etc.
  return Promise.resolve(valueFetchedFromBackend)
}

// Create a new cache intance
let cache = new PopulatingCache(fetchFunc)

// PUT values into the cache and store them for later
cache.put("key1", "Just any value")
cache.put("key2", {foo: "bar"} )
cache.put("key3", [1,2,"three"] )
// GET a value back from the cache:
let value = await cache.get("someKey")

// store one array item
cache.put("array[4]", "fifth item") 
let arrayItem = await get("array[4]")
let fullArray = await get("array")

// Store a value with an _id in an array
cache.put("posts/4711", { _id:4711, title: "Blog post title"})
// If the passed value does not have an _id property,
// then populating-cache will automatically add the _id from the path,
// so that you can always receive the value back under that same path:
let post = await cache.get("posts/4711")

// get(path) will automatically call fetchFunc(path) if there is 
// no value or an expired value under that path.
// Therefore get() is an asynchrounous function. It returns a Promise.
// When a value is fetched from the backend, 
// then it is automatically cached for future get calls.
let valueFromBackend = await cache.get("key2")
```

## Populating cache is a tree structure

You may simply store values under String keys. But `Populating-Cache` can also store values in a tree structure. The cached elements in this tree are identified by the path from the root of the tree to that element.
Values in the cache (normally) sit at the leaves of this tree.

Example: Cache the tags of post with `_id="af3d-e3ff"`. If a post with that `_id` does not yet exist, then it will automatically be created in the cache.

```javascript
cache.put(["post/af3d-e3ff", "tags"], ["tag1", "tag2"])
```

When you `get` something from the cache, you will receive that cache element and everything under it.

![Cache tree example](http://www.plantuml.com/plantuml/proxy?src=https://raw.githubusercontent.com/Doogiemuc/populating-cache/main/docs/populating-cache-example1.plantuml)

## Path into the cache

A `path` defines where a value will be stored in the cache. It is an _array of path elements_ from the root of the cache to the position of value in the cache. When you call `put(path, value)` then the algorithm walks along `path` and and then stores `value` at the end of this path. All intermediate elements along the path (objects & arrays) will automatically be created if necessary.

Each path element must be one of:

-   a plain string. Value will be stored under that key, e.g. `"childKey"`
-   an array with index. Value will be stored in this array element, e.g. `"array[7]"`
-   a string in the format `key/_id`, e.g. `"posts/af3d-e3ff"`. Value will be stored under the array element with that `_id` (The name of your `_id`-attribute can be configured)
-   or an object for the same purpose, e.g. `{posts: "af3d-e3ff"}`

When you `put` a value in the cache, then the last element in the path may be the name of an array with brackets, e.g. `myArray[]`. This means: _Append_ value to the end of `myArray`.

## Examples for usage of path

```javascript
// Store value under a path
cache.put(["parentKey", "childArray[3]"], value)  // cache.parentKey.childArray[3] = value

// Populting-Cache can automatically find array items by their _id and store values under this item.
// Creator of comment with id "ef37d" in post with id "id42"
// (Here we store a user object in the cache.)
cache.put(["posts/af3d-e3ff", "comments/4ccf-ff33", "createdBy"], {_id:"14a3-2e2f", name: "John Doe", email: "john@doe.com"}) 

// Path elements can also be objects. This results in the same path as the example above.
cache.put([{posts:"af3d-e3ff"}, {comments:"4ccf-ff33"}, "createdBy"], user)
```

## Time to life (TTL)

When you `put` a value into the cache, then metadata about that value will also be stored. Each value can have a time to life after which it expires. When you try to `get` and expired value,
then it is be refetched from the backend. When a value is expired, then also all its children are considered to be expired. (But not referenced entities. They have their own TTL.)

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
    { // This is the referenced user
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
  let result = await cache.get(path) 
  // result is now "user1@domain.com"
```

When a DBref is resolved, then of course the TTL of the referenced target entity (in our example `user/901`) is taken into account. If that user's data in the cache is expired, then a query for that user will be sent to the backend. The response of the backend will be used to update the user data in the cache. The TTL in the metadata will be refreshed. And this updated data will be used to populate the DBref.

<div style="border: 1px solid #33F; padding: 5px; margin-bottom: 5rem;">
Population does not change the $refPath property nor the referenced element in the cache. Only the value returned by `get(path)` will contain the resolved child elements.
</div>

# Advanced Usage

### Merge properties into existing values

```javascript
put("key", { foo: "bar"})
put("key", { baz: "boo"}, { merge: true}) // Will throw an error if cache[key] is not an object.
```

### Store arrays and work with array items

```javascript
// Cache an array
put("array", ["one", "two", "three"])
// Replace the third element of array with "item2"
// This will create the array if necessary.
// and throw an error if "array" is not an array.
put("array[2]", "item2")
// replace the third element of array with an object
put("array[2]", { foo: "bar"})
// merge property "baz" into the third element of array.
put("array[2]", { baz: "boo"}, { merge: true})
// Array now looks like this:
assert.equals(await cache.get("array"), ["one", "two", {
	foo: "bar",
	baz: "boo"
}])

// Append "item" to array. 
// Will create a new array if necessary.
// Will throw an error if "array" is an object.
put("array[]", "item" )
// Be carefull, don't forget the brackets! This would store the String value "item"
// under the key "array" and replace your array. This is most probably not what you want.
put("array", "item" )
// You can also pass append: true as an option
put("array[]", "item", { append: true} )
put("array", "item", { append: true} )    // this is ok, but not recommended
```

### Working with object ids

```javascript
// Example: User created a new comment under a blog post
let newComment = {_id:42, text:"This is a comment"}
// Append newComment to array of comments of post with _id = 4711
put(["posts/4711", "comments[]"], newComment)
// This will throw an id-mismatch error, because newComment has _id=42 and not 9999
put(["posts/4711", "comments/9999"], newComment)
// Will implicitly add _id:42 to the passed value.
put(["posts/4711", "comments/42"], {text: "just something"})
// Merge property "baz" into existing comment with _id = 42
put(["posts/4711", "comments/42"], {baz:"boo"}, {merge:true})
```

Object IDs can be numeric or alphanumeric UUIDs. The name of the `_id` property can be configured.

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
    -   [isInCache](#isincache)
        -   [Parameters](#parameters-5)
    -   [getCacheData](#getcachedata)
    -   [getMetadata](#getmetadata)
        -   [Parameters](#parameters-6)
    -   [emptyCache](#emptycache)
    -   [deleteExpiredElems](#deleteexpiredelems)
    -   [parsePath](#parsepath)
        -   [Parameters](#parameters-7)
    -   [path2rest](#path2rest)
        -   [Parameters](#parameters-8)
-   [DEFAULT_CONFIG](#default_config)

## PopulatingCache

Populating Cache

A lightweight client side cache that can store values in a tree structure.
<https://github.com/doogiemuc/populating-cache>

### Parameters

-   `fetchFunc` **[Function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** async function that will be called to fetch elements from the backend. One param: _path_
-   `config` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** configuration parameters that may overwrite the DEFFAULT_CONFIG

### put

Cache `value` under the given `path` in this cache. The value may then be retrieved back with a call to `get(path)`.
All intermediate objects along the path will be created in the cache if necessary.
Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured `defaultTTLms`.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** path under which the `value` shall be stored in the cache
-   `value` **Any** The value to store in the cache.
-   `ttl` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** time to live / how long value can be stored in the cache. Defaults to config.defaultTTLms (optional, default `this.config.defaultTTLms`)
-   `merge`   (optional, default `false`)

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`

### get

Fetch a value from the cache. If the value isn't in the cache or if it is expired, 
then the backend will be queried for the value under `path`.

When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** array that forms the path to the value that shall be fetched.
        Each array element can be one of three formats:
          \- a plain "attributeName" for object properties in the cache.
          \- { arrayAttr: "abde3f"} for the array element with that id.
          \- "array[index]" for array elements. Index must be a positive.
        For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
        For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
-   `callBackend`   (optional, default `this.CALL_BACKEND_WHEN_EXPIRED`)
-   `populate` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** Automatically populate DBrefs from this cache if possible. (optional, default `this.config.populate`)
-   `force` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** Force calls to backend, even when cache element is not yet expired

Returns **any** (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.

### getOrFetch

This method decides if the backend needs to be called to fetch a given value.
The backend will be called, IF

-   cacheElem is null, ie. not yet in the cache
-   cacheElem is expired, because its metadata.ttl is in the past.
-   or when callBackend === FORCE_BACKEND_CALL

When the backend is call, then the returned value is PUT() back into the cache
with and updated TTL.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** The full path to cacheElem
-   `cacheElem` **Any** the leaf element at the end of path or null if not in the cache yet
-   `metadata` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** metadata for cacheElem
-   `callBackend` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** always call backend if true

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** element either directly from the cache or fetched from the backend

### delete

Delete an element from the cache. It's value will be set to undefined.
If path points to an array element, then that array element will be set to 
undefined, so that the length of the array does not change.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** path to the element that shall be deleted

### isInCache

Check if a path points to a defined and not yet expired value in the cache.
If the value is expired, the backend will not be called.
If path points to an `undefined` value, then isInCache will return false.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** path to an element in the cache
-   `populate` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** wether to populate DBrefs along path (optional, default `this.config.populate`)

Returns **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if there is a value in the cache and it is not yet expired.

### getCacheData

Get (a direct reference!) to all the data in the cache.
The cacheData is exactly as returned by `fetchFunc(path)`

### getMetadata

While you `put` values into the cache, Populating-Cache automatically
creates a second parallel tree of metadata next to the `cacheData`.
The metadata contains the time to life (TTL) of the value in the cache.
`_ttl` is the number of milliseconds since the epoc, when the value expires.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** fetch metadata of a specific element. If null or undefind, that all metadata of the whole cache is returned.

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** metadata of cached value under path, e.g. { \_ttl: 55235325000, \_type: "Integer"}

### emptyCache

Completely empty out the cache. This also clears out all metadata.

### deleteExpiredElems

Recursively walk through the cacheData and delete all expired elements.
You MAY call this from time to time to optimize the cache's memory consumption

### parsePath

Parse a path into an array of { key, id, index } objects.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** plain string or array of path elements


-   Throws **any** an Error when path or a path element is invalid

Returns **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** Array of parsed objects { key, id, index }. `id` or `index` may be undefind in each path element.

### path2rest

Convert the given path to a REST URL path.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** a populating-cache path array

## DEFAULT_CONFIG

Default configuration for a cache. You can overwrite these when creating a new PopulatingCache instance.
Each cache instance can have its own configuration.
