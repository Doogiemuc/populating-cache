/**
 * Populating Cache
 *
 * A lightweight client side cache that can store values in a tree structure.
 * https://github.com/doogiemuc/populating-cache
 */

/**
 * Default configuration for a cache. You can overwrite these when creating a new PopulatingCache instance.
 * Each cache instance can have its own configuration.
 */
const DEFAULT_CONFIG = {
	// one minute
	defaultTTLms: 60 * 1000,

	// Should get() return cloned values or direct references to the attribute from the cache
	returnClones: false,

	// Should referenced pathes automatically be resolved and populated by default. This default can be overriden when calling `GET()`.
	populate: true,

	//TODO: Name of _id attribute used when looking up `entity/febb3` or `user/42`
	idAttr: "_id",

	// Name of the JSON attribute that marks a referenced path (DBRef), e.g. `createdByUser: { $refPath: "users/4711" }`
	referencedPathAttr: "$refPath"
}

/* Unbelievably clever RegEx to extract (key, id, index) from path elements of type string :-) */
const pathElemRegEx = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)(\[(?<index>\d+)\])?(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*))?$/

/**
 * Clever implementation of a client side cache.
 */
class PopulatingCache {
	// private "fields"
	//   cacheData - the cached data
	//   cacheMetadata - e.g. time to life / TTL

	/**
	 * Create a new instance of a PopulatingCache.
	 * You may create several cache instances, for example for different types of data in your app or with different configuration.
	 * @param {Function} fetchFunc async function that will be called to fetch elements from the backend. One param: *path*
	 * @param {Object} config configuration parameters that may overwrite the DEFFAULT_CONFIG
	 */
	constructor(fetchFunc, config) {
		if (typeof fetchFunc !== "function") throw Error("Need a fetchFunc(tion) to create PopulatingCache")
		this.fetchFunc = fetchFunc
		this.config = { ...DEFAULT_CONFIG, ...config }
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
	 * @param {Number} ttl time to live / how long value can be stored in the cache. Defaults to config.defaultTTLms
	 * @returns {Object} the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`
	 */
	put(path, value, ttl = this.config.defaultTTLms) {
		let cacheElem = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		const parsedPath = this.parsePath(path)

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			const index = parsedPath[i].index

			// If path[i] is a plain string, then step into that key in the cache.
			if (key && index === undefined && id === undefined) {
				if (i < parsedPath.length - 1) {
					cacheElem = cacheElem[key] || (cacheElem[key] = {}) // create the attribute in the cache if necessary
					metadataElem = metadataElem[key] || (metadataElem[key] = {})
				} else {
					// If this is the last element in path, then set the value at this position in the cache,
					// replacing anything that was previously there.
					cacheElem[key] = value 
					metadataElem[key] = {
						_ttl: Date.now() + ttl,
						_type: typeof value,
					}
				}
			}
			// If path[i] is an string that defines an array element "key[index]" then step into it.
			else if (key && index >= 0 && id === undefined) {
				if (!cacheElem[key]) cacheElem[key] = [] // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				if (i < parsedPath.length - 1) {
					cacheElem =
						cacheElem[key][index] || (cacheElem[key][index] = {})
					metadataElem =
						metadataElem[key][index] ||
						(metadataElem[key][index] = {})
				} else {
					cacheElem[key][index] = value // if this is the last element in the  path, then set the value as this array element
					metadataElem[key][index] = {
						_ttl: Date.now() + ttl,
						_type: typeof value,
					}
				}
			}
			// If elem of path is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				const cacheArray = cacheElem[key] || (cacheElem[key] = []) // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				let foundIndex = cacheArray.findIndex((e) => e._id == id)
				// If "key"-array does not have an element with that _id, then we add a new element to the array.
				if (foundIndex === -1) {
					cacheArray.push({ _id: id })
					foundIndex = cacheArray.length - 1
				}
				if (i < parsedPath.length - 1) {
					cacheElem = cacheElem[key][foundIndex]
					metadataElem =
						metadataElem[key][foundIndex] ||
						(metadataElem[key][foundIndex] = {_id: id})
				} else {
					if (typeof value !== "object") value = { _id: id, value }
					// If value has a different (or missing) ID than what the last element of path declares, then we must correct value here
					// to satisfy the always valid invariant `cache.put(path, value)  => cache.get(path) = value`
					if (value && value._id && value._id != id) {
						console.warn(`WARNING: ID mismatch! You tried to PUT a value under path ${JSON.stringify(path)}. But your value had value._id=${value._id}. I changed this to value._id=${id}`)  // eslint-disable-line
						// eslint-disable-next-line no-param-reassign
						value._id = id 
					}
					if (value && !value._id) {
						console.warn(`You tried to PUT a value without an _id at path ${JSON.stringify(path)}. I added id=${id}`)  // eslint-disable-line
						// eslint-disable-next-line no-param-reassign
						value._id = id
					}
					cacheElem[key][foundIndex] = value
					metadataElem[key][foundIndex] = {
						_id: id,
						_ttl: Date.now() + ttl,
						_type: typeof value,
					}
				}
			} else {
				throw Error(
					`Invalid path element ${i}: ${JSON.stringify(
						parsedPath[i]
					)}`
				)
			}
		}
		return this
	}

	/**
	 * Fetch a value from the cache. If the value isn't in the cache or if it is expired, 
	 * then the backend will be queried for the value under `path`.
	 * If `force==true` then the value will always be queried from the backend.
	 * When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.
	 *
	 * @param {String|Array} path array that forms the path to the value that shall be fetched.
	 *     Each array element can be one of three formats:
	 *       - a plain "attributeName" for object properties in the cache.
	 *       - { arrayAttr: "abde3f"} for the array element with that id.
	 *       - "array[index]" for array elements. Index must be a positive.
	 *     For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
	 *     For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
	 * @param {Boolean} force Force calls to backend, even when cache element is not yet expired
	 * @param {Boolean} populate Automatically populate DBrefs from this cache if possible.
	 * @returns (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.
	 * @rejects When the value couldn't be fetched or there was an API error in your backend.
	 */
	async get(path, force = false, populate = this.config.populate) {
		let cacheElem = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		const parsedPath = this.parsePath(path)

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			const index = parsedPath[i].index

			// If path[i] is a plain string, then step into that key.
			if (key && index === undefined && id === undefined) {
				cacheElem = cacheElem[key]
				// If there is no cacheElem under that key, then immideately call the backend.
				if (!cacheElem) break 
				// If cacheElem is a DBref, then (try to) populate it.
				if (populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						force,
						populate
					)
				}
				// If cacheElem is expired then force fetch it from the backend.
				// This will PUT the returned value back into the cache with an updated TTL.
				if (metadataElem && metadataElem[key]) {
					if (metadataElem[key].ttl < Date.now()) {
						cacheElem = await this.getOrFetch(path.slice(0,i+1), undefined, undefined, true)  // force fetch
					}
					metadataElem = metadataElem[key]
				}
			}
			// If path[i] is a string that defines an array element "key[<number>]" then step into that array element.
			else if (key && index >= 0 && id === undefined) {
				cacheElem = cacheElem[key][index]
				if (!cacheElem) break
				if (populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						force,
						populate
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						cacheElem = await this.getOrFetch(path.slice(0,i+1), undefined, undefined, true)
					}
					metadataElem = metadataElem[key][index]
				}
			}
			// If path[i] was "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				if (!cacheElem[key]) break
				const index = cacheElem[key].findIndex((e) => e._id == id) // eslint-disable-line no-shadow
				if (index === -1) break // if there is no element with a matching _id, then immideately try to query for the full path
				cacheElem = cacheElem[key][index]
				if (populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						force,
						populate
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index]._ttl < Date.now()) {
						cacheElem = await this.getOrFetch(path.slice(0,i+1), undefined, undefined, true)
					}
					metadataElem = metadataElem[key][index]
				}
			} else {
				throw Error(
					`Invalid path element ${i}: ${JSON.stringify(path[i])}`
				)
			}
		}

		// 
		return this.getOrFetch(path, cacheElem, metadataElem, force)
	}

	/**
	 * This method decides if the backend needs to be called to fetch a given value.
	 * The backend will be called, IF
	 *  - cacheElem is null, ie. not yet in the cache
	 *  - cacheElem is expired, because its metadata.ttl is in the past.
	 *  - or when force === true
	 *
	 * When the backend is call, then the returned value is PUT() back into the cache
	 * with and updated TTL.
	 *
	 * This method will only be called for leaf elements at the end of path. We never query for "in between" elements along a path.
	 *
	 * @param {Array} path The full path to cacheElem
	 * @param {Any} cacheElem the leaf element at the end of path or null if not in the cache yet
	 * @param {Object} metadata metadata for cacheElem
	 * @param {Boolean} force always call backend if true
	 * @returns {Promise} element either directly from the cache or fetched from the backend
	 */
	async getOrFetch(path, cacheElem, metadata, force) {
		if (!cacheElem || force || (metadata && metadata._ttl < Date.now())) {
			return this.fetchFunc(path).then((res) => {
				this.put(path, res)
				return res
			})
		}
		return Promise.resolve(cacheElem)
	}

	/**
	 * Parse a path into an array of { key, id, index } objects.
	 *
	 * @param {String|Array} path plain string or array of path elements
	 * @returns {Object} Parsed out { key, id, index } Either `id` or `index` is undefind in the returned object.
	 * @throws an Error when path or a path element is invalid
	 */
	parsePath(path) {
		let result = []
		if (!path) throw new Error("Cannot parse empty path.")

		// If path is a string, then split it at the dots or otherwise wrap it into an array.
		if (typeof path === "string") {
			if (path.includes(".")) {
				result = path.split(".")
			} else {
				result = [path]
			}
		} else if (Array.isArray(path)) {
			result = [...path] // shallow copy
		} else {
			throw new Error(
				"Cannot parse path. Path must be an Array or String."
			)
		}

		// Loop over path array elements and parse each of them.
		for (let i = 0; i < result.length; i++) {
			const pathElem = result[i]
			if (!pathElem) {
				throw new Error(`path[${i}] is null or undefined.`) // MAYBE: Skip this pathElem
			} else if (typeof pathElem === "string") {
				// If elem is a string, then extract key, and either id or index from it: "key", "key/id" or "key[index]"
				const match = pathElem.match(pathElemRegEx)
				if (!match)	
					throw new Error(`Invalid string pathElem path[${i}]="${pathElem}"`)
				if (match.groups.id && match.groups.index) 
					throw new Error(`Cannot use index and id at the same time in path[${i}]${pathElem}`)
				result[i] = {
					key: match.groups.key,
					id: match.groups.id, // may also be undefined for plain string keys
					index: match.groups.index
						? parseInt(match.groups.index, 10)
						: undefined,
				}
			} else if (
				typeof pathElem === "object" &&
				Object.keys(pathElem).length === 1
			) {
				// If path[i] can be an object of the form {key: id}
				result[i] = {
					key: Object.keys(pathElem)[0],
					id: Object.values(pathElem)[0],
					index: undefined
				}
			} else {
				throw new Error(
					"Cannot parse path. Invalid pathElem path["+i+"]="+JSON.stringify(pathElem)
				)
			}
		}
		return result
	}

	/**
	 * Delete an element from the cache. It's value will be set to undefined.
	 * @param {Array} path path to the element that shall be deleted
	 */
	delete(path) {
		// TODO: remove element from array with path syntax "array[index]"
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
	 * While you `put` values into the cache, Populating-Cache automatically
	 * creates a second parallel tree of metadata next to the `cacheData`.
	 * The metadata contains the time to life (TTL) of the value in the cache. `_ttl` is the number of milliseconds
	 * since the epoc, when the value expires.
	 * @param {Array} path fetch metadata of a specific element. If null or undefind, that all metadata of the whole cache is returned.
	 * @returns {Object} metadata of cached value under path, e.g. { _ttl: 55235325000, _type: "Integer"}
	 */
	getMetadata(path) {
		if (!path) return this.cacheMetadata
		let metadataElem = this.cacheMetadata || {}
		const parsedPath = this.parsePath(path)

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			const index = parsedPath[i].index
			if (!metadataElem || !metadataElem[key]) return undefined

			// If path[i] is a plain string, then step into that key.
			if (key && index === undefined && id === undefined) {
				metadataElem = metadataElem[key]
			}
			// If path[i] is a string that defines an array element "key[<number>]" then step into that array element.
			else if (key && index >= 0 && id === undefined) {
				metadataElem = metadataElem[key][index]
			}
			// If path[i] was "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				const index = metadataElem[key].findIndex((e) => e._id === id)
				// if there is no metadataElem with a matching _id, then immideately return undefined
				if (index === -1) return undefined 				
				metadataElem = metadataElem[key][index]
			} else {
				throw Error(
					`Invalid path element ${i}: ${JSON.stringify(path[i])}`
				)
			}
		}
		return metadataElem
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
	 
	expireOldTtls() {
		// TODO: recursively walk the cache and delete expired elements
	}
	*/

	/**
	 * Convert the given path to a REST URL path.
	 * @param {Array} path a populating-cache path array
	 */
	path2rest(path) {
		if (!Array.isArray(path)) throw Error("Path must be an array")
		let restPath = ""
		for (let i = 0; i < path.length; i++) {
			const el = [i]
			if (typeof el === "string") {
				if (el.includes("["))
					throw new Error(
						`Cannot convert path with array[index] elements to REST URL: ${el}`
					)
				restPath += `/${el}`
			} else {
				const key = Object.keys(el)[0]
				restPath += `/${key}/${el[key]}`
			}
		}
		return restPath
	}
} // end of class

export default PopulatingCache

// See also https://github.com/node-cache/node-cache/blob/master/_src/lib/node_cache.coffee
