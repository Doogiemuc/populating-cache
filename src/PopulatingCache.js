/**
 * Populating Cache
 *
 * A lightweight client side cache that can store values in a tree structure.
 * https://github.com/doogiemuc/populating-cache
 */
class PopulatingCache {
	// private "fields"
	//   cacheData - the cached data
	//   cacheMetadata - e.g. time to life / TTL

	/**
	 * Create a new instance of a PopulatingCache.
	 * You may create several cache instances, for example for different types of data in your app or with different configuration.
	 * @param {Object} config configuration parameters that may overwrite the DEFFAULT_CONFIG
	 */
	constructor(config) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.cacheData = {}
		this.cacheMetadata = {}

		// CONSTANTS
		// always call backend for fresh value
		this.FORCE_BACKEND_CALL = 1

		// call backend for not yet cached or expired values (this is the default)
		this.CALL_BACKEND_WHEN_EXPIRED = 0

		// do not call the backend for this get() call. This is used to check if a value is already in the cache.
		this.DO_NOT_CALL_BACKEND = -1
	}

	/**
	 * Cache `value` under the given `path` in this cache. The value may then be retrieved back with a call to `get(path)`.
	 * All intermediate objects along the path will be created in the cache if necessary.
	 * Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured `defaultTTLms`.
	 *
	 * @param {Array} path path under which the `value` shall be stored in the cache
	 * @param {Any} value The value to store in the cache.
	 * @param {Object} options Override default configuration options, e.g. ttl or merge properties
	 * @returns {Object} the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`
	 */
	put(path, value, options) {
		let cacheElem = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		let opts = { ...this.config, ...options }
		const parsedPath = this.parsePath(path)

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			const appendArray = parsedPath[i].appendArray
			let index = parsedPath[i].index

			// If path[i] is a plain string key
			if (key && index === undefined && id === undefined && !appendArray) {
				if (i < parsedPath.length - 1) {
					// then step into that key in the cache. Create object if necessary.
					cacheElem    = cacheElem[key]    || (cacheElem[key] = {}) 
					metadataElem = metadataElem[key] || (metadataElem[key] = {})
				} else {
					// If this is the last element in path, then store value in the cache
					// If value is an object and merge === true, then only merge properties from value into current cacheElem[key]
					if (opts.merge && typeof value === "object") {
						cacheElem[key] = {...cacheElem[key], ...value}
					} else {
						cacheElem[key] = value
					}
					metadataElem[key] = {
						_ttl: Date.now() + opts.ttl,
						_type: typeof value,
					}
				}
			}
			// If path[i] was in the form "array[]", then append value to that array
			else if (key && index === undefined && id === undefined && appendArray) {
				if (!cacheElem[key]) cacheElem[key] = [] // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				if (i < parsedPath.length - 1) {
					throw new Error('"appendArray[]" is only allowed as the last element of path in PUT()')
					//TODO: Can we allow this in intermediate elements in PUT? 
					//  => This is complex! What type of element should I append to the array here? a String, 
					//     an object or another array? This depends on the next elem in path
				} else {
					// If this is the last element in path, then append value to end of this array
					if (!Array.isArray(cacheElem[key]))
						throw new Error("Cannot append to array. Last element in path is not an array.")
					cacheElem[key].push(value)
					metadataElem[key].push({
						_ttl: Date.now() + opts.ttl,
						_type: typeof value,
					})
				}
			}
			// If path[i] is an string that defines an array element "key[index]" then step into it.
			else if (key && index >= 0 && id === undefined) {
				if (!cacheElem[key]) cacheElem[key] = [] // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				if (i < parsedPath.length - 1) {
					cacheElem    = cacheElem[key][index]    || (cacheElem[key][index] = {})
					metadataElem = metadataElem[key][index] || (metadataElem[key][index] = {})
				} else {
					// if this is the last element in the  path, then set the value as this array element
					if (opts.merge && typeof value === "object") {
						cacheElem[key][index] = {...cacheElem[key][index], ...value}
					} else {
						cacheElem[key][index] = value 
					}
					metadataElem[key][index] = {
						_ttl: Date.now() + opts.ttl,
						_type: typeof value,
					}
				}
			}
			// If path[i] is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				const cacheArray = cacheElem[key] || (cacheElem[key] = []) // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				index = cacheArray.findIndex((el) => el[this.config.idAttr] == id)
				// If "key"-array does not have an element with that _id, then add a new element to the array.
				if (index === -1) {
					cacheArray.push({ [this.config.idAttr]: id })
					index = cacheArray.length - 1
				}
				if (i < parsedPath.length - 1) {
					cacheElem    = cacheElem[key][index]
					metadataElem = metadataElem[key][index] || (metadataElem[key][index] = {[this.config.idAttr]: id})
				} else {
					// If value is not an object then wrap it in an object and add id, so that we can receive it back under that path.
					if (typeof value !== "object") value = { [this.config.idAttr]: id, value }
					// If value has a different (or missing) ID than what the last element of path declares, then we must correct value here
					// to satisfy the always valid invariant `cache.put(path, value)  => cache.get(path) = value`
					if (value && value[this.config.idAttr] && value[this.config.idAttr] != id) {
						throw new Error(`ID mismatch! You tried to PUT a value under path ${JSON.stringify(path)}.
						  But your value had value.${this.config.idAttr}=${value[this.config.idAttr]}.`)
					}
					if (value && !value[this.config.idAttr]) {
						console.warn(`You tried to PUT a object value without an ${this.config.idAttr} 
						   at path ${JSON.stringify(path)}. I added id=${id}`)
						value[this.config.idAttr] = id
					}
					if (opts.merge && typeof value === "object") {
						cacheElem[key][index] = {...cacheElem[key][index], ...value}
					} else {
						cacheElem[key][index] = value 
					}
					metadataElem[key][index] = {
						[this.config.idAttr]: id,
						_ttl: Date.now() + opts.ttl,
						_type: typeof value,
					}
				}
			} else {
				throw Error(`Invalid path element ${i}: ${JSON.stringify(parsedPath[i])}`)
			}
		}
		return this
	}

	/**
	 * Fetch a value from the cache. If the value isn't in the cache or if it is expired, 
	 * then the backend will be queried for the value under `path`.
	 * 
	 * When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.
	 *
	 * @param {String|Array} path array that forms the path to the value that shall be fetched.
	 *     Each array element can be one of three formats:
	 *       - a plain "attributeName" for object properties in the cache.
	 *       - { arrayAttr: "abde3f"} for the array element with that id.
	 *       - "array[index]" for array elements. Index must be a positive.
	 *     For example: [{posts:5}, {comments:42}] is the comment with id 42 of the post with id 5
	 *     For a REST backend this can be translated to the REST resource at  /posts/5/comments/42
	 * @param {Object} options Override default options, e.g. force call to backend or do not populate.
	 * @returns (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.
	 * @rejects When the value couldn't be fetched or there was an API error in your backend.
	 */
	async get(path, options) {
		let cacheElem = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		let opts = {...this.config, ...options}
		if (typeof opts.fetchFunc !== "function") return Promise.reject("Need fetchFunc to fetch value at path="+JSON.stringify(path))
		const parsedPath = this.parsePath(path)

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			let   index = parsedPath[i].index

			// If path[i] is a plain string, then step into that key.
			if (key && index === undefined && id === undefined) {
				cacheElem = cacheElem[key]
				// If there is no cacheElem under that key, then immideately call the backend.
				if (!cacheElem) break 
				// If cacheElem is a DBref, then (try to) populate it.
				if (opts.populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						opts
					)
				}
				// If this cacheElem is expired then fetch it from the backend.
				// This will PUT the returned value back into the cache with an updated TTL.
				if (metadataElem && metadataElem[key]) {
					if (metadataElem[key].ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(path.slice(0,i+1), undefined, undefined, opts)
					}
					metadataElem = metadataElem[key]
				}
			}
			// If path[i] is a string that defines an array element "array[<number>]" then step into that array element.
			else if (key && index >= 0 && id === undefined) {
				cacheElem = cacheElem[key][index]
				if (!cacheElem) break
				if (opts.populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						opts
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(path.slice(0,i+1), undefined, undefined, opts)
					}
					metadataElem = metadataElem[key][index]
				}
			}
			// If path[i] was "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				if (!cacheElem[key]) break
				index = cacheElem[key].findIndex((el) => el[this.config.idAttr] == id) // eslint-disable-line no-shadow
				if (index === -1) break // if there is no element with a matching _id, then immideately try to query for the full path
				cacheElem = cacheElem[key][index]
				if (opts.populate && cacheElem[this.config.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[this.config.referencedPathAttr],		// path to referenced element in the cache
						opts
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index]._ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(path.slice(0,i+1), undefined, undefined, opts)
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
		return this.fetchIfExpired(path, cacheElem, metadataElem, opts)
	}

	/**
	 * Get a value from the cache. Or fetch it from the backend with fetchFunc,
	 * if the value is not in the cache or expired.
	 * FetchFunc will be called with param as path.
	 * 
	 * If your backend requires authentication, fetchFunc is responsible to handle that.
	 * 
	 * @param {Array|String} path path to value that you want to get from the cache
	 * @param {Function} fetchFunc async function that will be called when the value is not in the cache (or expired)
	 */
	async getOrFetch(path, fetchFunc) {
		return this.get(path, { fetchFunc: fetchFunc})
	}

	/**
	 * This method decides if the backend needs to be called to fetch a given value.
	 * The backend will be called, IF
	 *  - cacheElem is null, ie. not yet in the cache
	 *  - cacheElem is expired, because its metadata.ttl is in the past.
	 *  - or when opts.callBackend === FORCE_BACKEND_CALL
	 *
	 * When the backend is called, then the returned value is PUT() back into the cache
	 * with and updated TTL.
	 *
	 * @param {Array} path The full path to cacheElem
	 * @param {Any} cacheElem the leaf element at the end of path or undefined if not in the cache yet
	 * @param {Object} metadata metadata for cacheElem
	 * @param {Object} opts config options, including fetchFunc
	 * @returns {Promise} resolves to cacheElem if it is not expired. Otherwise tries to query for value with fetchFunc().
	 * @rejects When element is not in the cache and opts.callBackend === DO_NOT_CALL_BACKEND
	 */
	async fetchIfExpired(path, cacheElem, metadata, opts) {
		switch(opts.callBackend) {
		case this.FORCE_BACKEND_CALL:
			return opts.fetchFunc(path).then((res) => {
				this.put(path, res)  // update TTL
				return res
			})
		case this.DO_NOT_CALL_BACKEND:
			if (metadata && metadata._ttl < Date.now()) {
				cacheElem = undefined // remove expired cacheElem    //TODO: does this work. Or do I have to call delete() ?
				return Promise.reject(undefined)
			}
			return Promise.resolve(cacheElem)   // cacheElem may also be undefined.
		default:
			if (!cacheElem || metadata && metadata._ttl < Date.now()) {
				return opts.fetchFunc(path).then((res) => {
					this.put(path, res)
					return res
				})
			} else {
				return Promise.resolve(cacheElem)
			}
		}
	}

	/**
	 * Recursively populate all DBrefs in elem with a given property name, e.g.
	 * populate all "createdBy" references (to "users") in an array of "posts":
	 * `populate(posts, "createdBy")`
	 * 
	 * @param {Object|Array} elem an element from the cache that contains DBrefs
	 * @param {String} refProp the name of the property that is a DBref and that shall be populated
	 * @param {Object} options configuration options (or will use defaults)
	 */
	async populate(elem, refProp, options) {
		let opts = {...this.config, ...options}
		if (Array.isArray(elem)) {
			for (let i = 0; i < elem.length; i++) {
				if (elem[i][this.config.referencedPathAttr]) {
					elem[i] = await this.get(elem[i][this.config.referencedPathAttr], opts)
				} else {
					await this.populate(elem[i], refProp, opts)
				}
			}
		} else if (typeof elem === "object") {
			for (const key in elem) {
				if (key === refProp && elem[key][this.config.referencedPathAttr]) {
					elem[key] = await this.get(elem[key][this.config.referencedPathAttr], opts)
				} else {
					await this.populate(elem[key], refProp, opts)
				}
			}
		}
		return elem
	}





	/**
	 * Delete an element from the cache. It's value will be set to undefined.
	 * If path points to an array element, then that array element will be set to 
	 * undefined, so that the length of the array does not change.
	 * @param {Array} path path to the element that shall be deleted
	 */
	delete(path) {
		this.put(path, undefined, -1)
	}

	
	/**
	 * Check if a path points to a defined and not yet expired value in the cache.
	 * If the value is expired, the backend will not be called.
	 * If path points to an `undefined` value, then isInCache will return false.
	 * @param {Array} path path to an element in the cache
	 * @param {Boolean} populate wether to populate DBrefs along path
	 * @return {Boolean} true if there is a value !== undefind in the cache and it is not yet expired.
	 */
	isInCache(path) {
		return this.get(path, {callBackend: this.DO_NOT_CALL_BACKEND})
			.then((value) => {
				return value !== undefined
			})
			.catch(() => false)
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
	 * The metadata contains the time to life (TTL) of the value in the cache.
	 * `_ttl` is the number of milliseconds since the epoc, when the value expires.
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
				const index = metadataElem[key].findIndex((e) => e[this.config.idAttr] === id)
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
	 * Completely empty out the cache. This also clears out all metadata.
	 */
	emptyCache() {
		this.cacheData = {}
		this.cacheMetadata = {}
	}

	/**
	 * Recursively walk through the cacheData and delete all expired elements.
	 * You MAY call this from time to time to optimize the cache's memory consumption
	 */
	deleteExpiredElems() {
		deleteExpiredElemsRec(this.cacheData, this.cacheMetadata)
	}

	// ============ helper methods ==============

	
	/**
	 * Parse a path into an array of { key, id, index } objects.
	 * See README.md for a detailed description about pathes in populating-cache.
	 *
	 * @param {String|Array} path plain string or array of path elements
	 * @returns {Array} Array of parsed objects { key, id, index }. `id` or `index` may be undefind in each path element.
	 * @throws an Error when path or a path element is invalid
	 */
	parsePath(path) {
		let result = []
		if (!path) throw new Error("Cannot parse empty path.")

		// If path is just a string, then split it at the dots or otherwise wrap it into an array.
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
				throw new Error(`path[${i}] is null or undefined.`)
			} else if (typeof pathElem === "string") {
				// If path[i] is a string, then extract key, and either id or index from it: "key", "key/id" or "array[index]" or "array[]"
				const match = pathElem.match(pathElemRegEx)
				if (!match || !match.groups.key)
					throw new Error(`Invalid string pathElem. No key in path[${i}]="${pathElem}"`)
				if (match.groups.id && match.groups.index) 
					throw new Error(`Cannot use index and id at the same time in path[${i}]=${pathElem}`)
				result[i] = {
					key: match.groups.key,
					id: match.groups.id, // may also be undefined for plain string keys
					index: match.groups.index ? parseInt(match.groups.index, 10) : undefined,
				}
				if (match.groups.appendArray === '[]') result[i].appendArray = true
			} else if (
				typeof pathElem === "object" &&
				Object.keys(pathElem).length === 1
			) {
				// If path[i] is an object of the form {key: id}
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


// ======== private methods ==========

let deleteExpiredElemsRec = function(elem, metadata) {
	if (!elem) return
	if (Array.isArray(elem)) {
		for (let i = 0; i < elem.length; i++) {
			const childMetadata = metadata ? metadata[i] : {}
			if (childMetadata._ttl < Date.now()) {
				elem[i] = undefined  // set array element to undefined, but keep array
				metadata[i] = undefined
			} else {
				deleteExpiredElemsRec(elem[i], childMetadata)
			}
		}
	} else if (typeof elem === "object") {
		for (const key in elem) {
			const childMetadata = metadata[key] || {}
			if (childMetadata._ttl < Date.now()) {
				delete elem[key]		// delete object property completely
				delete metadata[key]
			} else {
				deleteExpiredElemsRec(elem[key], childMetadata)
			}
		}
	}
}

/**
 * Default configuration for a cache. You can overwrite these when creating a new PopulatingCache instance.
 * Each cache instance can have its own configuration.
 */
const DEFAULT_CONFIG = {
	// ===== options for GET =====

	// Global fetchFunc that will be called with path when a value needs to be fetched from the backend.
	// fetchFunc MUST return a Promise, e.g. myFetchFunc(path) => { return Promise.resolve(valueFromBackend )}
	// You can also provide an individual fetchFunc to each getOrFetch(path, individualFetchFunc) call.
	fetchFunc: undefined,

	// Call backend when value in cache is expired (or not there at all)
	callBackend: 0, // = PopulatingCache.CALL_BACKEND_WHEN_EXPIRED

	//TODO: Should get() return cloned values or direct references to the attribute from the cache
	returnClones: false,

	// ===== options for PUT =====

	// default time to live is 60 seconds
	ttl: 60 * 1000,

	// Should referenced pathes automatically be resolved and populated by default. This default can be overriden when calling `GET()`.
	populate: true,

	// Name of _id attribute used when looking up `entity/febb3` or `user/42`
	idAttr: "_id",

	// Name of the JSON attribute that marks a referenced path (DBRef), e.g. `createdByUser: { $refPath: "users/4711" }`
	referencedPathAttr: "$refPath",

	// Merge object properties into existing values when PUTing
	merge: false,

	// append to end of array
	append: false,
	
}

/** 
 * Unbelievably clever RegEx to extract {key, id, index} from path elements of type string :-) 
 * 
 * First we have a key: One more more characters. Must start with a letter or underscore or dollar. May later contain hyphen(-).
 * Then either an array index in brackets
 * or only brackets to append to an array (but only in the last element of path)
 * or a slash with an alphanumercial id, e.g. key/3d4f-abc5
 */
// eslint-disable-next-line max-len
const pathElemRegEx = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)((\[(?<index>\d+)\])|(?<appendArray>\[\])|(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*)))?$/



export default PopulatingCache
