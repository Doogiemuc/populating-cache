# Populating-Cache - JS client side cache

A lightweight JavaScript client side cache. Data that you fetch from your backend is cached locally, for example in an app running on a mobile device, and only fetched again when it has expired.

[![Build Status](https://www.travis-ci.com/Doogiemuc/populating-cache.svg?branch=main)](https://www.travis-ci.com/Doogiemuc/populating-cache)
![NPM](https://img.shields.io/npm/l/populating-cache)
![npm](https://img.shields.io/npm/v/populating-cache)

## Features

-   Cached data is stored in memory, as a plain JavaScript object.
-   Values can be anything you can store in a JavaScript variable: strings, numbers, arrays or JSON objects.
-   Every value has a time to live (TTL). When it has expired, then the value is fetched again from your backend.
-   Lists _and_ their single elements have TTLs of their own. Cache a whole list and refresh single elements of it.
-   Populating-Cache is not just a key=value store. Values are stored in a tree under a [path](#path-into-the-cache), e.g. `"posts/4711.comments"`.
-   An object in the cache may reference another object in the cache via its path, e.g. a post's `createdBy` may reference the user at `users/42`. These references (DBrefs) are [populated](#populate-db-references-dbref) automatically when you `get` values from the cache.
-   Subscribe to changes in the cache.
-   Thoroughly tested and configurable.
-   No dependencies!

## Contents

-   [Simple usage](#simple-usage)
-   [Fetch a value from the backend](#fetch-a-value-from-the-backend)
-   [Configuration](#configuration)
-   [Populating cache is a tree structure](#populating-cache-is-a-tree-structure)
-   [Path into the cache](#path-into-the-cache)
-   [Time to live (TTL)](#time-to-live-ttl)
-   [Populate DB references (DBref)](#populate-db-references-dbref)
-   [Subscribe to changes](#subscribe-to-changes)
-   [Advanced usage](#advanced-usage)
-   [Upgrading to 6.0](#upgrading-to-60)
-   [API](#api)

## Simple usage

Install the npm dependency in your project: `npm install populating-cache`

```javascript
import PopulatingCache from 'populating-cache'  // the module exports a class

// Create a new cache instance (More details on "fetchFunc" below.)
const cache = new PopulatingCache({ fetchFunc: (path) => Promise.resolve("valueFetchedFromBackend") })

// PUT values into the cache and store them for later
cache.put("key1", "Just any value")
cache.put("key2", { foo: "bar" })
// GET a value back from the cache:
const value = await cache.get("key1")         // "Just any value"

// PUT an array into the cache
cache.put("myArray", [0, 1, 2, 3])
cache.put("myArray[1]", 111)                  // replace one array element
cache.put("myArray[]", 4)                     // append to array
const arrayItem = await cache.get("myArray[2]") // 2
const fullArray = await cache.get("myArray")    // [0, 111, 2, 3, 4]

// PUT an object with an _id into the cache
const aPost = { _id: 4711, title: "Blog post title" }
cache.put("posts/4711", aPost)
const cachedPost = await cache.get("posts/4711")  // cachedPost === aPost

// Values that are not in the cache are fetched from the backend
const fetched = await cache.get("somethingElse")  // "valueFetchedFromBackend"
```

## Fetch a value from the backend

When you try to `get` a value that is either not yet in the cache or already expired, then it is fetched from the backend. Populating-cache will
 1. call your `fetchFunc(path)` to receive the current value from the backend,
 2. `put` the returned value into the cache with a fresh TTL,
 3. and then `get(path)` resolves to the value as returned by your `fetchFunc()`.

```javascript
/**
 * When a value needs to be fetched from the backend,
 * then populating-cache will call this function that you must provide.
 * @param {Array} path normalized path to the value that needs to be fetched,
 *                e.g. [{posts: 4711}, "comments"]
 * @return {Promise} value that you fetched from your backend
 */
const fetchFunc = function(path) {
  // [...] call backend, make REST request, etc.
  return Promise.resolve(valueFetchedFromBackend)
}

const cache = new PopulatingCache({
  fetchFunc: fetchFunc,
  ttl: 60 * 1000    // time to live for elements in the cache
})
```

`fetchFunc` is always called with the [normalized form](#path-into-the-cache) of the path. For a REST backend, `cache.path2rest(path)` converts it to a URL path like `/posts/4711/comments`.

You can also pass a `fetchFunc` for one call only: `cache.get(path, { fetchFunc: myOtherFetchFunc })`.

### When is the backend called?

The option `callBackend` controls this. Set it in the config or for one call to `get`:

| Value                                       | Behaviour of `get(path)`                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cache.CALL_BACKEND_WHEN_EXPIRED` (default) | Returns the cached value. Calls the backend only when the value is not in the cache or expired.              |
| `cache.FORCE_BACKEND_CALL`                  | Always calls the backend and updates the cache.                                                              |
| `cache.DO_NOT_CALL_BACKEND`                 | Never calls the backend. Resolves to the cached value or `undefined`, and rejects when the value is expired. |

```javascript
const fresh = await cache.get("posts/4711", { callBackend: cache.FORCE_BACKEND_CALL })
```

If you only want to look into the cache without a Promise, then use `getSync(path)` or `isInCache(path)`. They never call the backend.

## Configuration

Each cache instance has its own configuration. Pass the options you want to change to the constructor: `new PopulatingCache({ fetchFunc, ttl: 30 * 1000 })`.
Most options can also be overridden for a single call to `put` or `get`.

| Option               | Default                     | Description                                                                                                                                                          |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchFunc`          | `undefined`                 | `async (path) => value` that fetches a value from your backend. Required for `get`.                                                                                  |
| `callBackend`        | `CALL_BACKEND_WHEN_EXPIRED` | When to call the backend, see [above](#when-is-the-backend-called).                                                                                                  |
| `fetchCollection`    | `false`                     | Fetch a missing or expired element `"key/id"` with its whole collection `"key"`, see [fetchCollection](#fetch-an-element-with-its-whole-collection-fetchcollection). |
| `ttl`                | `60000`                     | Time to live of values that are put into the cache, in milliseconds.                                                                                                 |
| `populate`           | `true`                      | Automatically resolve [DBrefs](#populate-db-references-dbref) when getting values.                                                                                   |
| `idAttr`             | `"_id"`                     | Name of the id attribute used to find elements like `"posts/4711"`.                                                                                                  |
| `referencedPathAttr` | `"$refPath"`                | Name of the attribute that marks a DBref, e.g. `createdBy: { $refPath: "users/42" }`.                                                                                |
| `merge`              | `false`                     | When you put an object, merge its properties into the cached object instead of replacing it.                                                                         |

## Populating cache is a tree structure

You may simply store values under string keys. But `Populating-Cache` is more powerful. It stores values in a tree structure. The cached elements in this tree are identified by the path from the root of the tree to the element.
Values in the cache (normally) sit at the leaves of this tree.

Example: Cache the tags of a post with `_id="af3d-e3ff"`. If a post with that `_id` does not yet exist, then it is automatically created in the cache.

```javascript
cache.put(["posts/af3d-e3ff", "tags"], ["tag1", "tag2"])
```

When you `get` something from the cache, you receive that cache element and everything under it.

![Cache tree example](http://www.plantuml.com/plantuml/proxy?src=https://raw.githubusercontent.com/Doogiemuc/populating-cache/main/docs/populating-cache-example1.plantuml)

## Path into the cache

A `path` defines where a value is stored in the cache. It is an _array of path elements_ from the root of the cache to the position of the value. When you call `put(path, value)` then the cache walks along `path` and stores `value` at the end of it. All intermediate elements along the path (objects and arrays) are created if necessary.

| Normalized form                    | Shortcut                | Description                                                        |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `["myKey"]`                        | `"myKey"`               | Key at root level in cache                                         |
| `["abc", "def", "ghi"]`            | `"abc.def.ghi"`         | deep path into cache                                               |
| `["myArray[3]"]`                   | `"myArray[3]"`          | the n-th element of an array                                       |
| `["myArray[]"]`                    | `"myArray[]"`           | append to an array (only for `put`, only as the last path element) |
| `[{posts: 4711}]`                  | `"posts/4711"`          | the element of the array `posts` that has that `_id`               |
| `["abc", {foo: "ID-4711"}, "bar"]` | `"abc.foo/ID-4711.bar"` | all types of elements can appear in one path                       |

> You may pass the shortcut form to `put` and `get`. Populating-cache always calls your `fetchFunc` with the normalized form.
> Numeric ids in the shortcut form become numbers: `"posts/4711"` is normalized to `[{posts: 4711}]`.

### Examples for usage of path

```javascript
// Store value under a path
cache.put(["parentKey", "childArray[3]"], value)  // cache.parentKey.childArray[3] = value

// Populating-Cache can find array items by their _id and store values under this item.
// Creator of the comment with id "4ccf-ff33" in the post with id "af3d-e3ff"
// (Here we store a user object in the cache.)
cache.put(["posts/af3d-e3ff", "comments/4ccf-ff33", "createdBy"], { _id: "14a3-2e2f", name: "John Doe", email: "john@doe.com" })

// Path elements can also be objects. This results in the same path as the example above.
cache.put([{ posts: "af3d-e3ff" }, { comments: "4ccf-ff33" }, "createdBy"], user)
```

## Time to live (TTL)

Each value in the cache has a time to live after which it expires. When you try to `get` an expired value, then it is fetched again by calling your `fetchFunc()`.

For simple keys this is simple. But since populating-cache is a tree structure, this can become more complex.

When you fetch a deep value at the end of a long `path`, then **all intermediate elements in the cache are also checked.**
If an intermediate element is expired, then the element at this sub path is fetched.

Example:

```javascript
// put a user object into the cache
cache.put("data.user", { name: "username", email: "john.doe@domain.com" })
// ... some time passes, until the user entity expires in the cache ...
const email = await cache.get("data.user.email")
```

Since the `user` element is already expired, this calls `fetchFunc(["data", "user"])` with the _normalized sub path_ to the expired `user` element.
The returned user is put into the cache with a fresh TTL, and then its `email` is returned.

### TTL of a collection and of each of its elements

An array in the cache (a _collection_) has a TTL of its own, and each of its elements has one, too.
So you can cache a whole list _and_ refresh single elements of it:

```javascript
cache.put("polls", listOfPolls)          // TTL of the list and of every poll in it
cache.put("polls/5", poll5)              // only refreshes the TTL of poll 5. The list's TTL is untouched.
cache.put("polls[]", newPoll)            // appends a poll with its own TTL
```

When checking if something is expired, **the most specific TTL wins**:

| Path                                         | Expires with                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| an element, e.g. `"polls/5"` or `"polls[0]"` | its own TTL. If it has none, then the TTL of its collection. If that has none either, it never expires. |
| the collection, e.g. `"polls"`               | only its own TTL                                                                                        |

So poll 5 that was refreshed on its own outlives the list: `get("polls/5")` returns it from the cache, while `get("polls")` already calls the backend.

A collection that was only built up from single elements (`put("polls/5", …)`, `put("polls[]", …)`) has no TTL of its own and therefore
`get("polls")` will not call the backend for it. Put the whole list once, if you want the list to expire.

### Fetch an element with its whole collection: `fetchCollection`

Often your backend can deliver the whole list in one call. Then set the option `fetchCollection: true`, in the config or for one call to `get`:

```javascript
const poll = await cache.get("polls/5", { fetchCollection: true })
```

When poll 5 is not in the cache or expired, then `fetchFunc(["polls"])` is called _instead of_ `fetchFunc([{polls: 5}])`.
The returned array is put into the cache under `"polls"` (with a fresh TTL for the list and every poll in it) and the poll with `_id` 5 is returned.
If the new list does not contain that id, then `get` resolves to `undefined`. One backend call refreshes all polls.
`fetchFunc` must resolve to an array in this case, otherwise `get` rejects.

This applies whenever the cache needs to fetch an element by id, also in the middle of a longer path like `"polls/5.title"`.

### Metadata

Next to the cached values, populating-cache keeps a parallel tree of metadata. You can inspect it with `getMetadata(path)`.
A value has `{ ttl, type }`, where `ttl` is the time in milliseconds since the epoch when the value expires.
A collection additionally has `$elems`, which runs in parallel to the cached array, index by index:

```javascript
cache.getMetadata("polls")
// {
//   ttl: 1700000060000,  type: "object",
//   $elems: [
//     { _id: 5, ttl: 1700000090000, type: "object" },   // refreshed on its own
//     { _id: 7, ttl: 1700000060000, type: "object" },
//   ]
// }
cache.getMetadata("polls/5")              // { _id: 5, ttl: 1700000090000, type: "object" }
cache.getMetadata("polls/5.proposals")    // metadata of values below an element are stored inside its entry
```

The names `ttl`, `type` and `$elems` are reserved in the metadata. `getMetadata` returns the nodes as they are stored, without the fallback to the collection's TTL.

### Clean up expired values

`get` never removes anything from the cache. Call `deleteExpiredElems()` from time to time to free memory.
It sets expired array elements (and their entry in `$elems`) to `undefined`, so arrays keep their length.
When a collection is expired, then only its elements without a fresh TTL of their own are removed. If none are left, the collection is deleted completely.

`delete(path)` removes one value, `emptyCache()` removes everything.

## Populate DB references (DBref)

The data returned by the backend may contain references to other entities. These references are inspired by [MongoDB DBrefs](https://docs.mongodb.com/manual/reference/database-references/#dbrefs) and the `populate()` function of the awesome [Mongoose](https://mongoosejs.com/docs/populate.html) lib.

When you `get` a value from the cache, then DBrefs can automatically be resolved from within the cache content. Let's use the following content of a `populating-cache` as an example:

```javascript
cacheData = {
  posts: [
    {
      _id: 4711,
      text: "This is an example post",
      comments: [
        {
          _id: 101,
          commentText: "This is a comment by user1",
          createdBy: {
            $refPath: "users/901"   // path to another entity in the cache
          }
        }
      ]
    }
  ],
  users: [
    { // This is the referenced user
      _id: 901,
      email: "user1@domain.com"
    },
  ]
}
```

A simple list of `posts`. Each post can have `comments`. And each comment is `createdBy` a `user`.
But the user is not stored again and again for every comment. Instead, users are cached separately under the top-level key `users`. Each comment then _references_ one user: `$refPath` is the path to that user in the cache. (The name of this attribute can be configured with `referencedPathAttr`.)

When a path in a call to `get(path)` spans a DBref, then this ref is automatically resolved:

```javascript
const path = [{ posts: 4711 }, { comments: 101 }, "createdBy", "email"]
const result = await cache.get(path)
// result is now "user1@domain.com"
```

When a DBref is resolved, then the TTL of the referenced entity (in our example `users/901`) is taken into account. If that user is expired in the cache, then it is fetched from the backend, put into the cache with a fresh TTL and used to populate the DBref.

You can also populate all DBrefs with a given name in a value you already have:

```javascript
const posts = await cache.get("posts")
await cache.populate(posts, "createdBy")   // replaces every createdBy DBref with the referenced user
```

> When resolving a path, population does not change the `$refPath` property nor the referenced element in the cache.
> Only the value returned by `get(path)` contains the resolved element. (`populate(elem, refProp)` however replaces the DBrefs in the `elem` you pass to it.)

Set `populate: false` in the config or for one call to `get` to receive the raw DBrefs.

## Subscribe to changes

You can subscribe to changes in the cache. Your listener is notified when a value is put into the cache.

```javascript
const cache = new PopulatingCache({ fetchFunc: fetchFunc })
const onPutListener = (path, value) => console.log(value + " was PUT into cache at path " + path)
const listener = cache.subscribe("foo", onPutListener)
cache.put("foo.some.path", "dummyValue")
// onPutListener("foo.some.path", "dummyValue") has now been called.
cache.unsubscribe(listener)
```

By default listeners are called when a value is put at or below their path. So by default the path is a prefix.
You can listen exactly to the changes of one element by passing `true` as the third argument: `cache.subscribe("some.path", exactListener, true)`. Then `exactListener` is only called when exactly the element at this path changes.

When you want to be notified about _all_ changes in the cache, then register a listener at root level: `cache.subscribe("", rootListener)`

When a value is deleted with `delete(path)`, then listeners are called with `onPut(path, undefined)`.

# Advanced usage

### Merge properties into existing values

```javascript
cache.put("key", { foo: "bar" })
cache.put("key", { baz: "boo" }, { merge: true })
// cache.get("key") now resolves to { foo: "bar", baz: "boo" }
```

`merge` only applies to objects. Arrays and scalar values always replace the cached value.

### Store arrays and work with array items

```javascript
// Cache an array
cache.put("array", ["one", "two", "three"])
// Replace the third element of array with "item2".
// This creates the array if necessary
// and throws an error if "array" is not an array.
cache.put("array[2]", "item2")
// replace the third element of array with an object
cache.put("array[2]", { foo: "bar" })
// merge property "baz" into the third element of array.
cache.put("array[2]", { baz: "boo" }, { merge: true })
// Array now looks like this:
assert.deepEqual(await cache.get("array"), ["one", "two", {
	foo: "bar",
	baz: "boo"
}])

// Append "item" to array.
// Creates a new array if necessary.
// Throws an error if "array" is not an array.
cache.put("array[]", "item")
// Be careful, don't forget the brackets! This would store the String value "item"
// under the key "array" and replace your array. This is most probably not what you want.
cache.put("array", "item")
```

### Working with object ids

```javascript
// Example: User created a new comment under a blog post
const newComment = { _id: 42, text: "This is a comment" }
// Append newComment to the array of comments of the post with _id = 4711
cache.put(["posts/4711", "comments[]"], newComment)
// This throws an id-mismatch error, because newComment has _id=42 and not 9999
cache.put(["posts/4711", "comments/9999"], newComment)
// Adds _id:42 to the passed value (and warns on the console).
cache.put(["posts/4711", "comments/42"], { text: "just something" })
// Merge property "baz" into existing comment with _id = 42
cache.put(["posts/4711", "comments/42"], { baz: "boo" }, { merge: true })
```

Object IDs can be numeric or alphanumeric UUIDs. The name of the `_id` property can be configured with `idAttr`.
IDs are compared by their string value, so `"polls/5"`, `{polls: 5}` and `{polls: "5"}` all address the element with `_id: 5` or `_id: "5"`.

Only objects can be stored under an id. `put("posts/4711", "a string")` throws an error.

### Store a value fetched elsewhere: `remember`

`cache.remember(path, fetchFunc)` always calls the given `fetchFunc(path)`, puts the result into the cache and resolves to it. Use it when you load data outside of `get`, but want it cached.

# Upgrading to 6.0

Version 6.0 gives collections a TTL of their own and one TTL per element. What changed for you:

-   **`getMetadata()` returns a new shape for collections:** `{ ttl, type, $elems: [ … ] }` instead of either `{ ttl, type }` or an array of element metadata.
-   **Values that never expired before now do expire.** In 5.x, elements of a list put with `put("polls", list)` had no TTL of their own and never expired, and putting a single element could erase the TTL of its list.
-   **`get("polls/99")` for an id that is not cached calls the backend.** 5.x returned the parent node instead.
-   **Ids are compared by their string value.** `"5"` and `5` are now the same id, so you no longer get duplicate elements.
-   **`put` under an id or index throws when the cached value is not an array.** 5.x silently wrote properties onto the object.
-   **`merge: true` no longer turns an array into an object.**
-   **`delete("posts/4711")` works.** 5.x threw an error for elements addressed by id.
-   **`path2rest(path)` works.** 5.x returned wrong URL paths.

# Tests

`Populating-cache` is heavily tested. Have a look at the [JEST test cases](./test/jest.test.js) and the [tests for TTLs of collections](./test/ttl.test.js). There you can also learn a lot about how to use populating-cache.

You can run all tests easily: `npm test`

# Praise & Kudos

Thanks to the creators of [node-cache](https://github.com/node-cache/node-cache/blob/master/_src/lib/node_cache.coffee) for coffeescript inspiration.

# API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

-   [PopulatingCache](#populatingcache)
    -   [Parameters](#parameters)
    -   [put](#put)
        -   [Parameters](#parameters-1)
    -   [get](#get)
        -   [Parameters](#parameters-2)
    -   [getSync](#getsync)
        -   [Parameters](#parameters-3)
    -   [remember](#remember)
        -   [Parameters](#parameters-4)
    -   [populate](#populate)
        -   [Parameters](#parameters-5)
    -   [subscribe](#subscribe)
        -   [Parameters](#parameters-6)
    -   [unsubscribe](#unsubscribe)
        -   [Parameters](#parameters-7)
    -   [delete](#delete)
        -   [Parameters](#parameters-8)
    -   [isInCache](#isincache)
        -   [Parameters](#parameters-9)
    -   [getCacheData](#getcachedata)
    -   [getMetadata](#getmetadata)
        -   [Parameters](#parameters-10)
    -   [emptyCache](#emptycache)
    -   [deleteExpiredElems](#deleteexpiredelems)
    -   [parsePath](#parsepath)
        -   [Parameters](#parameters-11)
    -   [getSubPath](#getsubpath)
        -   [Parameters](#parameters-12)
    -   [path2rest](#path2rest)
        -   [Parameters](#parameters-13)
-   [DEFAULT_CONFIG](#default_config)

## PopulatingCache

Populating Cache

A lightweight client side cache that can store values in a tree structure.
<https://github.com/doogiemuc/populating-cache>

### Parameters

-   `config` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** configuration options that override the [DEFAULT_CONFIG](#default_config), e.g. `{ fetchFunc, ttl: 30000 }`

### put

Cache `value` under the given `path` in this cache. The value may then be retrieved back with a call to `get(path)`.
All intermediate objects along the path will be created in the cache if necessary.
Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured default `ttl`.

Collections (arrays) have a TTL of their own and one TTL per element:

-   `put("polls", array)` sets the TTL of the collection and of each of its elements.
-   `put("polls/5", poll)`, `put("polls[2]", poll)` or `put("polls[]", poll)` only set the TTL of that one element.
    The TTL of the collection stays untouched.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** path under which the `value` shall be stored in the cache
-   `value` **Any** The value to store in the cache.
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** Override default configuration options, e.g. `ttl` or `merge`


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when path is invalid, when a scalar value is put under an id, when the id of value does not match the id in path
      or when an array element is put into something that is not an array.

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`

### get

Fetch a value from the cache. If the value isn't in the cache or if it is expired,
then the backend will be queried for the value under `path`.

When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.

The most specific TTL wins: An array element expires with its own TTL if it has one (e.g. from `put("polls/5", poll)`),
otherwise with the TTL of its collection (e.g. from `put("polls", array)`). The collection itself only expires with its own TTL.

With the option `fetchCollection: true`, a missing or expired element `"polls/5"` is not fetched on its own.
Instead `fetchFunc` is called for its whole collection `["polls"]`. The returned array is put into the cache
and the element with the matching id is returned, or `undefined` when the new list does not contain it.

Get does not change the content of the cache at all. Specifically it does not remove expired elements.
You can call `deleteExpiredElems()` manually to cleanup the cache.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** array that forms the path to the value that shall be fetched.
        Each array element can be one of three formats:
          \- a plain "attributeName" for object properties in the cache.
          \- { arrayAttr: "abde3f"} for the array element with that id.
          \- "array[index]" for array elements. Index must be a positive.
        For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
        For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** Override default options, e.g. force call to backend, do not populate or fetchCollection.

Returns **any** (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.

### getSync

This is a synchrounous version of get(). getSync() does not return a Promise. It returns the value at path directly
if there is a valid value in the cache.

getSync() will not call the backend It can only return values that already are in the cache.

When there is a value in the cache, but it is expired, then there are two possible scenarios:
1\. Simply return undefined to the caller. (This is the default)
2\. Throw an Error. This way the caller can distinguish between "not in the cache at all" or "expired value at that path"

getSync() can do population, but only with values that already are in the cache.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** path to value in cache
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** optionally override configuration options  (callBackend and fetchCollection are ignored in this method.)
-   `throwWhenExpired` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** should the method throw when path points to an expired element.
      This way the caller can distinguish between "not in the cache at all" or "expired value at path". (optional, default `false`)


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when an element along path is expired and throwWhenExpired = true.
      Otherwise undefined is returned for expired values. Also throws when path is invalid.

Returns **any** the value from the cache if there is one. (getSync() does not return a Promise, but the value itself.)

### remember

Fetch a value from the backend and put it into the cache.
This will force a call to the backend, no matter if there alreay is a value in the cache.
If your backend requires authentication, fetchFunc is responsible to handle that.

#### Parameters

-   `path` **([Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array) \| [String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String))** path to value that you want to get from the cache
-   `fetchFunc` **[Function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** async function that will be called to fetch the value

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** resolves to the fetched value

### populate

Recursively populate all DBrefs in elem with a given property name, e.g.
populate all "createdBy" references (to "users") in an array of "posts":
`populate(posts, "createdBy")`

#### Parameters

-   `elem` **([Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** an element from the cache that contains DBrefs
-   `refProp` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** the name of the property that is a DBref and that shall be populated
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** configuration options (or will use defaults)

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)** resolves to elem with its DBrefs replaced by the referenced values

### subscribe

Subscribe to changes at a given path (or below a path prefix)

The listener's onPut(path, value) method will be called, when a value is PUT into the cache.
When a value is deleted, then onPut(path, undefined) is called.
By default listeners are also called when a value is put below the path. 
This can be changed by passing exact = true. Then the listener is only notified, when the value at exactly this path is changed.

#### Parameters

-   `path` **Any** path prefix where we listen to changes. If undefined, then listener will be notified for every change of the cache.
-   `onPutFunc` **[Function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** callback function that will be notified when a value is put into the cache: onPutFunc(path, value)
-   `exact` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** Notify listener only when the value at exactly this path is changed (default=false) (optional, default `false`)


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when path is invalid

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the listener. Pass it to `unsubscribe(listener)` to stop listening.

### unsubscribe

Stop notifying a listener.

#### Parameters

-   `listener` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the listener as returned by `subscribe()`

### delete

Delete an element and its metadata from the cache.
If path points to an array element, e.g. `"polls/5"` or `"polls[0]"`, then that array element and its entry in `$elems`
will be set to undefined, so that the length of the array does not change.
Listeners are notified with `onPut(path, undefined)`.

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** path to the element that shall be deleted


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when path is invalid or ends in "array\[]"

### isInCache

Check if a path points to a defined and not yet expired value in the cache.
If path points to an `undefined` value, then isInCache will return false.
This method will not change the content of the cache or metadata and will not call the backend at all.
(Use `getSync(path)` to fetch the value at a path.)

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** path to an element in the cache

Returns **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** true if there is a value !== undefined at that path and it is not yet expired.

### getCacheData

Get (a direct reference!) to all the data in the cache.
The cacheData is exactly as returned by `fetchFunc(path)`

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** the root of the cached data

### getMetadata

While you `put` values into the cache, Populating-Cache automatically
creates a second parallel tree of metadata next to the `cacheData`.
The metadata contains the time to life (TTL) of the value in the cache.
`ttl` is the number of milliseconds since the epoc, when a value will expire.

The metadata of a collection (array) has its own `ttl` and `type` and an array `$elems`
with one metadata entry per element, index by index: `{ ttl, type, $elems: [ { _id, ttl, type }, … ] }`.
The names `ttl`, `type` and `$elems` are reserved.

Returns the metadata node as it is stored, i.e. an element without an own entry or `ttl` has none here.
(`get()` then falls back to the `ttl` of the collection.)

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** path to a specific element. If null or undefined, then the metadata of the whole cache is returned.

Returns **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** metadata of cached value under path, e.g. `{ ttl: 55235325000, type: "number" }`, or undefined

### emptyCache

Completely empty the cache and delete all values in it. This also clears out all metadata.

### deleteExpiredElems

Recursively walk through the cacheData and delete all expired elements.
You may call this from time to time to optimize the cache's memory consumption.

Expired array elements and their entries in `$elems` are set to undefined, so that arrays keep their length.
When a collection is expired, then only its elements without a fresh TTL of their own are removed.
If none of them are left, then the collection is deleted completely.

### parsePath

Parse a path into a normalized array of `{ key, id, index, appendArray }` objects.
<b>Internally</b> populating-cache uses these normalized pathes.
See README.md for a detailed description about pathes in populating-cache.

<h3>Elements of normalized path arrray</h3>
{
  "key": the string key of the path,
  "id":  the alphanumerical ID for path elements like "posts/4711",
  "index": numerical array index, eg. from "array[42]"
  "appendArray": boolean, only used for PUT, e.g. put("posts[]", {title: "new post"})
}

#### Parameters

-   `path` **([String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String) \| [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array))** plain string or array of path elements


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when path or a path element is invalid

Returns **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** Array of parsed objects { key, id, index, appendArray }. `id` or `index` may be undefind in each path element.

### getSubPath

This is the inverse of `parsePath(path)`. This method takes a parsedPathArray as input
and converts it back to a path as used by `put`, `get` and `fetchFunc`

#### Parameters

-   `parsedPathArray` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** parsedPath is an array of { id, key, index } objects as created by the `parsePath(path)` method
-   `start` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** start index in parsedPath Array to create sub pathes (optional, default `0`)
-   `end` **[Number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** end index (exclusive) for sub path (optional, default `parsedPathArray.length`)

Returns **any** the partial path recreated from parsedPathArray. Path elements in the form "key/id" are returned as {key:id}

### path2rest

Convert the given path to a REST URL path, e.g. `[{posts: 11}, "comments"]` to `"/posts/11/comments"`.

#### Parameters

-   `path` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** a populating-cache path array


-   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** when path is not an array or contains an "array[index]" element

Returns **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** the REST URL path

## DEFAULT_CONFIG

Default configuration for a cache. You can overwrite these when creating a new PopulatingCache instance.
Each cache instance can have its own configuration.
See [Configuration](#configuration) for a description of all options.
