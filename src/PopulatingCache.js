/*
	get(keyPath)								=> get from cache if present, otherwise fetch from remote.     error?
	get(keyPath, force=true)		=> force fetch from remote (skip cache content) and cache new result. 
	set   						=> in cache only
	write							=> write to remote (and update local cache) async  Caller needs to be able to handle error response


	# Examples

	````
	cache.get("cachedPrimitive")							// => 4711
	cache.get("posts")												// => Anything thats cached under object key "posts", e.g. the Array of posts
	cache.get(["posts", "category"])					// => returns this.cache.posts.category  (one value)
	cache.get(["usersById", "4711"])					// => the this.cache.userById["4711"]
	cache.get([{posts: 1}])											// <= the post with id 1 from the array of posts
	cache.get([{posts: 5}, {comments: "adfbe435d"}, "createdBy", "email"])		// walk the tree and populate all necessary references
	````
*/

const DEFAULT_CONFIG = {
	defaultTTLms: 60 * 1000,		// one minute
	returnClones: false,				// Should get() return cloned values or direct references to the attribute from the cache
}

/* Unbelievably clever RegEx to match path elements of type string :-) */
const pathElemRegEx = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)(\[(?<index>\d+)\])?(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*))?$/

/**
 * # Populating Cache
 * Doogie simplementation of a cache.
 */
class PopulatingCache {
	// private "fields"
	//   cacheData - the cached data
	//   cacheMetadata - e.g. time to life / TTL


	constructor(fetchFunc, config) {
		if (typeof fetchFunc !== "function") throw Error("Need a fetchFunc(tion) to create PopulatingCache")
		this.fetchFunc = fetchFunc
		this.config = DEFAULT_CONFIG  //{...DEFAULT_CONFIG, ...config}
		this.cacheData = {}
		this.cacheMetadata = {}
	}

	/**
	 * Cache `value` under the given `path` in this cache. The value may then be retrieved back with a call to `get(path)`.
	 * All intermediate objects along the path will be created in the cache if necessary.
	 * Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured `defaultTTLms`.
	 * 
	 * @param {Array} path path under which the `value` shall be stored in the cache
	 * @param {Any} value The value to store in the cache.
	 * @param {Number} ttl time to life / how long value can be stored in the cache. Defaults to config.defaultTTLms
	 * @return {Object} the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`
	 */
	put(path, value, ttl = this.config.defaultTTLms) {
		let cacheElem    = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		// If path is only one single string, then store value under that key.
		if (typeof path === "string") path = [path]
			
		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < path.length; i++) {
			let key, id, index
			if (!path[i]) {
				throw Error("Path elements must not be null. Elemnt "+i+" in your path was null or undefined.")
			} else
			// If paht[i] is a string, then extract key, id and index from it: "key", "key/id" or "key[index]"
			if (typeof path[i] === "string") {
				if (path[i] === "_id") console.warn("Are you sure that you want to store an _id in the cache?")
				let match = path[i].match(pathElemRegEx)
				if (match === null) return Promise.reject("Cannot PUT: invalid path element path["+i+"]="+path[i])
				key   = match.groups.key
				id    = match.groups.id
				index = match.groups.index
			} else 
			// If path[i] is an object of the form {key: id} then use that.
			if (typeof path[i] === "object"){
				key = Object.keys(path[i])[0]
				id = Object.values(path[i])[0]
				index = undefined
			}

			// If path[i] is a plain string, then step into that key in the cache.
			if (key && index === undefined && id === undefined) {
				if (i < path.length-1) {
					cacheElem    = cacheElem[key] || (cacheElem[key] = {})					// create the attribute in the cache if necessary
					metadataElem = metadataElem[key] || (metadataElem[key] = {})
				} else {
					cacheElem[key] = value			// If this is the last element in path, then set the value at this position in the cache, replacing anything that was previously there.
					metadataElem[key] = {
						_ttl: Date.now() + ttl,
						_type: typeof value
					}
				}
			} else 
			// If path[i] is an string that defines an array element "key[index]" then step into it.
			if (key && index && id === undefined) {
				if (!cacheElem[key]) cacheElem[key] = []				// create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				if (i < path.length-1) {
					cacheElem    = cacheElem[key][index] || (cacheElem[key][index] = {})
					metadataElem = metadataElem[key][index] || (metadataElem[key][index] = {})
				} else {
					cacheElem[key][index] = value		// if this is the last element in the  path, then set the value as this array element 
					metadataElem[key][index] = {
						_ttl: Date.now() + ttl,
						_type: typeof value
					}
				}
			} else 
			// If elem of path is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			if (key && index === undefined && id) {
				let cacheArray = cacheElem[key] || (cacheElem[key] = [])			// create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				let foundIndex = cacheArray.findIndex(e => e._id === id)
				// If "key"-array does not have an element with that _id, then we add a new element to the array.
				if (foundIndex === -1) {
					cacheArray.push({_id: id})
					foundIndex = cacheArray.length-1
				}
				if (i < path.length -1) {
					cacheElem = cacheElem[key][foundIndex]
					metadataElem = metadataElem[key][foundIndex] || (metadataElem[key][foundIndex] = {})
				} else {
					if (typeof value !== "object") value = { _id: id, value: value}
					if (value && value._id && value._id !== id) {
						console.warn("WARNING: ID mismatch! You tried to PUT a value under path "+JSON.stringify(path)+". But your value had _id="+value._id+". I corrected that.")
						value._id = id
					}
					if (value && !value._id) {
						console.warn("You tried to PUT a value without an _id at path "+JSON.stringify(path)+". I added id="+id)
						value._id = id
					}
					cacheElem[key][foundIndex] = value
					metadataElem[key][foundIndex] = {
						_ttl: Date.now() + ttl,
						_type: typeof value
					}
				}
			} 
			else {
				throw Error("Invalid path element "+i+": "+JSON.stringify(path[i]))
			}
		}
	}

	/**
	 * Fetch a value from the cache. If the value isn't in the cache or if it is expired, then the backend will be queried for the value under `path`.
	 * If `force==true` then the value will always be queried from the backend.
	 * When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.
	 *
	 * @param path array that forms the path to the value that shall be fetched. 
	 *     Each array element can be one of three formats: 
	 *       - a plain "attributeName" for object properties in the cache.
	 *       - { arrayAttr: "abde3f"} for the array element with that id.
	 *       - "array[index]" for array elements. Index must be a positive. 
	 *     For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
	 *     For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
	 * @param force Force calls to backend, even when cache element is not yet expired
	 * @param populate Automatically populate DBrefs from this cache if possible.
	 * @returns (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.
	 * @rejects When the value couldn't be fetched and there was an API error.
	 * @See shouldCallBackend()
	 * @See Config.returnClones
	 */
	async get(path, force = false, populate = true) {
		//return this.getImpl(0, path, force, this.cacheData, this.cacheMetadata)

		let cacheElem    = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}

		// If path is only one single string, then retreive that value. Either from the cache or call the backend
		if (typeof path === "string") {
			return this.getOrFetch([path], cacheElem[path], metadataElem[path], force)
		}

		// Walk along path and get cacheElem and its metadataElem
		for (let i = 0; i < path.length; i++) {
			let key, id, index
			if (!path[i]) {
				throw Error("Path elements must not be null. Elemnt "+i+" in your path was null or undefined.")
			} else
			// If paht[i] is a string, then extract key, id and index from it: "key", "key/id" or "key[index]"
			if (typeof path[i] === "string") {
				let match = path[i].match(pathElemRegEx)
				if (match === null) return Promise.reject("Cannot PUT: invalid path element path["+i+"]="+path[i])
				key   = match.groups.key
				id    = match.groups.id
				index = match.groups.index
			} else 
			// If path[i] is an object of the form {key: id} then use that.
			if (typeof path[i] === "object"){
				key = Object.keys(path[i])[0]
				id = Object.values(path[i])[0]
				index = undefined
			}
				
			// If path[i] is a plain string, then step into that key in the cache.
			if (key && index === undefined && id === undefined) {
				cacheElem    = cacheElem[key]
				if (!cacheElem) break;		// If any element along the path is not found, then try to query for the element at the end of the path.
				if (populate && cacheElem.$ref) {
					cacheElem = await this.populate(cacheElem, force)
				}
				metadataElem = metadataElem[key] || (metadataElem[key] = {})
			} else 
			// If path[i] is an string that defines an array element "key[index]" then step into it.
			if (key && index && id === undefined) {
				cacheElem    = cacheElem[key][index]
				if (!cacheElem) break;
				if (populate && cacheElem.$ref) {
					cacheElem = await this.populate(cacheElem, force)
				}
				if (!metadataElem[key]) metadataElem[key] = []
				metadataElem = metadataElem[key][index] || (metadataElem[key][index] = {})
			} else 
			// If elem of path is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			if (key && index === undefined && id) {
				let cacheArray = cacheElem[key] || (cacheElem[key] = [])			// create array in cache if necessary
				let foundIndex = cacheArray.findIndex(e => e._id === id)
				if (foundIndex === -1) break;
				cacheElem = cacheArray[foundIndex]
				if (populate && cacheElem.$ref) {
					cacheElem = await this.populate(cacheElem, force)
				}
				metadataElem = metadataElem[key] || (metadataElem[key] = {})
			} 
			else {
				throw Error("Invalid path element "+i+": "+JSON.stringify(path[i]))
			}
		}
		return this.getOrFetch(path, cacheElem, metadataElem, force)
	}



	getOrFetch(path, cacheElem, metadata, force) {
		if (!cacheElem || force || (metadata && metadata.ttl < Date.now()))
			return this.fetchFunc(path)
		return Promise.resolve(cacheElem)
	}


	/**
	 * Delete an element from the cache. It's value will be set to undefined.
	 * @param {Array} path path to the element that shall be deleted
	 */
	delete(path) {
		//TODO: remove element from array with path syntax "array[index]"
		this.put(path, undefined, -1)
	}

	/**
	 * Get (a direct reference!) to all the data in the cache.
	 * The cacheData is exactly as returned by `fetchFunc(path)`
	 */
	getCacheData() {
		return this.cacheData
	}

	/**
	 * While you `put` values into the cache, populating cache automatically
	 * creates a second parallel tree of metadata next to the `cacheData`.
	 * The metadata contains the time to life TTL for each leave element.
	 */
	getCacheMetadata() {
		return this.cacheMetadata
	}

	/**
	 * Completely empty the cache. This also clears out all metadata.
	 */
	emptyCache() {
		this.cacheData = {}
		this.cacheMetadata = {}
	}
	
	/**
	 * Recursively walk through the cacheData and delete all expired elements.
	 * You MAY call this from time to time to optimize the cache's memory consumption
	 */
	expireOldTtls() {
		//TODO: recursively walk the cache and delete expired elements
	}

	/**
	 * Get the tree elem at path from the cache.
	 * We always try to get every elem along the path from the cache, except
	 *  - when the cached elem is expired
	 *  - when there is no cached element
	 * 
	 * When force is true, then we always get the tree element from the backend.
	 * //TODO: should in between elments also be refreshed?
	 * 
	 * @param {Number} i index in path
	 * @param {Array} path path along the tree of entities in the cache
	 * @param {Boolean} force Force a call to backend on the <b>last</b> elem in path
	 * @param {Object} cache subtree of this.cacheData for element path[i]
	 * @param {Object} metadata subtree of this.cacheMetadata for element path[i]
	 */
	async getImpl___OLD(i, path, force, cache, metadata) {
		if (i == path.length) {
			//console.log("found", cache)
			return cache
		}

		// if path is only a string, then return the cached element under that key.
		if (typeof path === "string") {
			if (force || cache[path] === undefined) {
				return await this.fetchFunc(path)
			} else {
				return cache[path]
			}
		}
		
		const elem = path[i]
		if (typeof elem === "string") {
			//Fetch a single value cached under the string key `elem`
			//console.log("checking String attr: ", elem)
			let cacheElem = cache[elem]
			if (cacheElem && cacheElem.$ref) {
				cacheElem = await populate(cacheElem, force)
			}
			if (this.shouldCallBackend(i, path, force, cacheElem, metadata[elem])) {
				cacheElem = await this.fetchFunc(path.slice(0,i+1))							// slice = shallow copy
			}
			return this.getImpl(i+1, path, force, cacheElem, metadata[elem] || {})
		} 
		else 
		{
			//Fetch an array of values and select the one with matching `id`.   elem = {"posts": 4711 }
			//console.log("checking keyVal", elem)
			let key = Object.keys(elem)[0]
			let id  = Object.values(elem)[0]
			let cacheArray = cache[key]
			let elemById
			if (this.shouldCallBackend(i, path, force, cacheArray, metadata[key])) {
				elemById = await this.fetchFunc(path.slice(0,i+1))
			} else {
				elemById = cacheArray.find(e => e._id === id)
			}
			if (!elemById) return Promise.reject(undefined)					// No element with that ID found in array
			return this.getImpl(i+1, path, force, elemById, metadata[key] || {})
		}
	}

	/**
	 * Check if we need to call the backend for this cacheElem.
	 *  - If cacheElem is undefined or null then of course we must call the backend.
	 *  - If cacheElem exists and is not the last elem in path (the leaf), then do NOT call the backend.
	 *    We only call the backend for leafs in the path.
	 *  - If cacheElem is expired, ie. its TTL is in the past, the call the backend.
	 *  - Otherwise cacheElem exists and is not expired. Then call the backend depending on the `force` value.
	 * 
	 * @param {Number} i Index in path
	 * @param {Array} path Path along the tree of entities. The leaf of this path shall be fetched.
	 * @param {Boolean} force Force call to backend. Skip the cache
	 * @param {Object} cache subtree of this.cacheData for element path[i]
	 * @param {Object} metadata subtree of this.cacheMetadata for element path[i]
	 */
	shouldCallBackend(i, path, force, cacheElem, metadata) {
		if (!cacheElem) return true
		if (i < path.length-1) return false		// do not call backend on in-between elements along path. Only call backend on last element in path
		if (metadata && metadata.ttl < Date.now()) return true
		return force
	}

	/**
	 * Populate the DBref at the given path.
	 * A call to `populate` simply builds a path array from the passed dbref and then forwards the call to the `get(path)` method.
	 * The data for the DBref is then either fetched directly from the cache or queried from the backend.
	 * 
	 * @param {Object} dbref the reference to another entity, e.g. { $ref: "users", $id: 1234 }
	 * @return the populated element that can replace the DBref
	 */
	populate(dbref, force) {
		console.log("populate", JSON.stringify(dbref), force)
		let path = [{[dbref.$ref]: dbref.$id}]
		return this.get(path, force)
	}

	path2rest(pathArray) {
		let restPath = ""
		for(let el of pathArray) {
			if (typeof el === "string") {
				restPath += '/'+el
			} else {
				let key = Object.keys(el)[0]
				restPath += '/'+key+'/'+el[key]
			}
		}
		return restPath
	}

}  // end of class

export default PopulatingCache


//TODO: getClone = true  by default
//See also https://github.com/node-cache/node-cache/blob/master/_src/lib/node_cache.coffee







// ==== Very hacked Test functions =====


/*
async function testGet() {
	
	//console.log(JSON.stringify(cacheData, null, 2))
	console.log("----------------------------------------")

	let primitive = await get(["cachedPrimitive"])
	console.log("CachedPrimitive:", primitive)
	
	let posts = await get(["posts"])
	console.log("posts:", JSON.stringify(posts))
  
	let posts1 = await get([{posts:1}], true)
	console.log("posts/1:", JSON.stringify(posts1))
	
	console.log("----------------------------------------")

	let path = [{posts:1}, {comments: 4711}, "createdBy", "email"]
	let res = await get(path, false)
	console.log(path2rest(path), "===>", JSON.stringify(res))
	

	console.log("----------------------------------------")
	console.log(JSON.stringify(cacheData, null, 2))
	
}
// testGet()


function testPut() {
	cacheData = {}
	//put(["eins", "zwei", "drei"], {foo: "myValue", bar: "dsaf"})
	put([{posts:123}, "postData", {comments:111}], {_id:111, comment: "Just a comment"})
	put([{posts:123}, "postData", {comments:112}], {_id:112, comment: "Second comment"})
	put([{posts:123}, "postData", {comments:113}, "category"], "CatWarn")

	console.log("----------------------------------------")
	console.log(JSON.stringify(cacheData, null, 2))
}
// testPut()


*/
