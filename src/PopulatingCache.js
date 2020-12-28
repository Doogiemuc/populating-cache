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
						ttl: Date.now() + opts.ttl,
						type: typeof value,
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
						ttl: Date.now() + opts.ttl,
						type: typeof value,
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
						ttl: Date.now() + opts.ttl,
						type: typeof value,
					}
				}
			}
			// If path[i] is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				const cacheArray = cacheElem[key] || (cacheElem[key] = []) // create array in cache if necessary
				if (!metadataElem[key]) metadataElem[key] = []
				index = cacheArray.findIndex((el) => el[opts.idAttr] == id)
				// If "key"-array does not have an element with that _id, then add a new element to the array.
				if (index === -1) {
					cacheArray.push({ [opts.idAttr]: id })
					index = cacheArray.length - 1
				}
				if (i < parsedPath.length - 1) {
					cacheElem    = cacheElem[key][index]
					metadataElem = metadataElem[key][index] || (metadataElem[key][index] = {[opts.idAttr]: id})
				} else {
					// If value is not an object then wrap it in an object and add id, so that we can receive it back under that path.
					if (typeof value !== "object") value = { [opts.idAttr]: id, value }
					// If value has a different (or missing) ID than what the last element of path declares, then we must correct value here
					// to satisfy the always valid invariant `cache.put(path, value)  => cache.get(path) = value`
					if (value && value[opts.idAttr] && value[opts.idAttr] != id) {
						throw new Error(`ID mismatch! You tried to PUT a value under path ${JSON.stringify(path)}.
						  But your value had value.${opts.idAttr}=${value[opts.idAttr]}.`)
					}
					if (value && value[opts.idAttr] === undefined) {
						console.warn(`You tried to PUT an object value without an ${opts.idAttr}`+
							`at path ${JSON.stringify(path)}. I added id=${id}`)
						value[opts.idAttr] = id
					}
					if (opts.merge && typeof value === "object") {
						cacheElem[key][index] = {...cacheElem[key][index], ...value}
					} else {
						cacheElem[key][index] = value 
					}
					metadataElem[key][index] = {
						[opts.idAttr]: id,
						ttl: Date.now() + opts.ttl,
						type: typeof value,
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
	 * Get does not change the content of the cache at all. Specifically it does not remove expired elements. 
	 * You can call `deleteExpiredElems()` manually to cleanup the cache.
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

		// Walk along path try to find the value and the end of path.
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			let   index = parsedPath[i].index

			// If path[i] is a plain string, then step into that key.
			if (key && index === undefined && id === undefined) {
				cacheElem = cacheElem[key]
				// If there is no cacheElem under that key, then immideately call the backend for the full path.
				if (!cacheElem) break 
				// If cacheElem is a DBref, then (try to) populate it.
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[opts.referencedPathAttr], // path to referenced element in the cache
						opts
					)
				}
				// If this cacheElem is expired then fetch it from the backend.
				// This will PUT the returned value back into the cache with an updated TTL.
				if (metadataElem && metadataElem[key]) {
					if (metadataElem[key].ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(this.getSubPath(parsedPath,0,i+1), undefined, undefined, opts)
						//We cannot simply call this.fetchFunc(path, i), because we need the logic in fetchIfExpired, 
						//e.g. reject when opts.DO_NOT_CALL_BACKEND and PUT the received value back into the cahge
					}
					metadataElem = metadataElem[key]
				}
			}
			// If path[i] is a string that defines an array element "array[<number>]" then step into that array element.
			else if (key && index >= 0 && id === undefined) {
				cacheElem = cacheElem[key][index]
				if (!cacheElem) break
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[opts.referencedPathAttr],		// path to referenced element in the cache
						opts
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(this.getSubPath(parsedPath,0,i+1), undefined, undefined, opts)
					}
					metadataElem = metadataElem[key][index]
				}
			}
			// If path[i] was "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				if (!cacheElem[key]) break
				index = cacheElem[key].findIndex((el) => el[opts.idAttr] == id) // eslint-disable-line no-shadow
				if (index === -1) break // if there is no element with a matching _id, then immideately try to query for the full path
				cacheElem = cacheElem[key][index]
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = await this.get(
						cacheElem[opts.referencedPathAttr],		// path to referenced element in the cache
						opts
					)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						cacheElem = await this.fetchIfExpired(this.getSubPath(parsedPath,0,i+1), undefined, undefined, opts)
					}
					metadataElem = metadataElem[key][index]
				}
			} else {
				throw Error(`Invalid path element ${i}: ${JSON.stringify(path[i])}`)
			}
		}

		// Check if cacheElem is expired. Return it or fetch it from the backend if necessary or forced by options
		return this.fetchIfExpired(path, cacheElem, metadataElem, opts)
	}

	/**
	 * This method decides if the backend needs to be called to fetch a given value.
	 * The backend will be called, IF
	 *  - cacheElem is undefined, ie. not yet in the cache
	 *  - cacheElem is expired, because its metadata.ttl is in the past.
	 *  - or when opts.callBackend === FORCE_BACKEND_CALL
	 *
	 * When the backend is called, then the returned value is also PUT() back into the cache
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
			if (metadata && metadata.ttl < Date.now()) {
				return Promise.reject(undefined)
			}
			return Promise.resolve(cacheElem)   // cacheElem may also be undefined.
		default:
			if (!cacheElem || metadata && metadata.ttl < Date.now()) {
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
	 * Synchronously get a value from the cache. This method will *not* call the backend.
	 * If path points to an expired value, then this method throws an Error("expired") that you can catch.
	 * getSync can do population, but only with values that already are in the cache.
	 * @param {Array} path path to value in cache
	 * @param {Object} options optionally override configuration options  (callBackend is ignored in this method.)
	 * @returns {*} the value from the cache if there is one.
	 */
	getSync(path, options) {
		let cacheElem = this.cacheData || {}
		let metadataElem = this.cacheMetadata || {}
		let opts = {...this.config, ...options}
		const parsedPath = this.parsePath(path)

		// Walk along path an try to find value at the end of path. (Without calling the backend).
		for (let i = 0; i < parsedPath.length; i++) {
			const key = parsedPath[i].key
			const id = parsedPath[i].id
			let   index = parsedPath[i].index

			// If path[i] is a plain string, then step into that key.
			if (key && index === undefined && id === undefined) {
				cacheElem = cacheElem[key]
				if (!cacheElem) return undefined
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = this.getSync(cacheElem[opts.referencedPathAttr], opts)
				}
				if (metadataElem && metadataElem[key]) {
					if (metadataElem[key].ttl < Date.now()) {
						throw new Error("expired")
					}
					metadataElem = metadataElem[key]
				}
			}
			// If path[i] is a string that defines an array element "array[<number>]" then step into that array element.
			else if (key && index >= 0 && id === undefined) {
				cacheElem = cacheElem[key][index]
				if (!cacheElem) return undefined
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = this.getSync(cacheElem[opts.referencedPathAttr], opts)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						throw new Error("expired")
					}
					metadataElem = metadataElem[key][index]
				}
			}
			// If path[i] was "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id) {
				if (!cacheElem[key]) return undefined
				index = cacheElem[key].findIndex((el) => el[opts.idAttr] == id) // eslint-disable-line no-shadow
				if (index === -1) return undefined
				cacheElem = cacheElem[key][index]
				if (opts.populate && cacheElem[opts.referencedPathAttr]) {
					cacheElem = this.getSync(cacheElem[opts.referencedPathAttr], opts)
				}
				if (metadataElem && metadataElem[key] && metadataElem[key][index]) {
					if (metadataElem[key][index].ttl < Date.now()) {
						throw new Error("expired")
					}
					metadataElem = metadataElem[key][index]
				}
			} else {
				throw Error(`Invalid path element ${i}: ${JSON.stringify(path[i])}`)
			}
		}
		
		return cacheElem   // my still be undefined
	}


	/**
	 * Fetch a value from the backend and put it into the cache.
	 * This will force a call to the backend, no matter if there alreay is a value in the cache.
	 * If your backend requires authentication, fetchFunc is responsible to handle that.
	 * 
	 * @param {Array|String} path path to value that you want to get from the cache
	 * @param {Function} fetchFunc async function that will be called to fetch the value
	 */
	async remember(path, fetchFunc) {
		// The idea for this perfectly fitting method name is from https://yarkovaleksei.github.io/vue2-storage/en/api.html#set
		if (!fetchFunc) return Promise.reject("Need a fetchFunc to remember a value for path"+JSON.stringify(path))
		return fetchFunc(path).then(value => {
			this.put(path, value)
			return value
		})
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
				if (elem[i][opts.referencedPathAttr]) {
					elem[i] = await this.get(elem[i][opts.referencedPathAttr], opts)
				} else {
					await this.populate(elem[i], refProp, opts)
				}
			}
		} else if (typeof elem === "object") {
			for (const key in elem) {
				if (key === refProp && elem[key][opts.referencedPathAttr]) {
					elem[key] = await this.get(elem[key][opts.referencedPathAttr], opts)
				} else {
					await this.populate(elem[key], refProp, opts)
				}
			}
		}
		return Promise.resolve(elem)
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
	 * If path points to an `undefined` value, then isInCache will return false.
	 * This method will not change the content of the cache or metadata and will not call the backend at all.
	 * 
	 * @param {Array} path path to an element in the cache
	 * @param {Boolean} populate wether to populate DBrefs along path
	 * @return {Boolean} true if there is a value !== undefind at that path and it is not yet expired.
	 */
	isInCache(path) {
		try {
			let value = this.getSync(path)
			return value !== undefined
		} catch(err) {
			return false // value is expired
		}
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
	 * `ttl` is the number of milliseconds since the epoc, when a value will expire.
	 * @param {Array} path fetch metadata of a specific element. If null or undefind, then all metadata of the whole cache is returned.
	 * @returns {Object} metadata of cached value under path, e.g. { ttl: 55235325000, type: "Integer"}
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
				throw Error(`Invalid path element ${i}: ${JSON.stringify(path[i])}`)
			}
		}
		return metadataElem
	}

	/**
	 * Completely empty the cache and delte all values in it. This also clears out all metadata.
	 */
	emptyCache() {
		this.cacheData = {}
		this.cacheMetadata = {}
	}

	/**
	 * Recursively walk through the cacheData and delete all expired elements.
	 * You may call this from time to time to optimize the cache's memory consumption
	 */
	deleteExpiredElems() {
		deleteExpiredElemsRec(this.cacheData, this.cacheMetadata)
	}

	// ============ helper methods ==============
	
	/**
	 * Parse a path into a normalized array of `{ key, id, index, appendArray }` objects.
	 * Internally populating-cache `put` and `get` use these normalized parsedPathes.
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
	 * This is the inverse of `parsePath(path)`. This method takes a parsedPathArray as input
	 * and converts it back to a path as used by `put` and `get`.
	 * @param {Array} parsedPathArray parsedPath is an array of { id, key, index } objects as created by the `parsePath(path)` method
	 * @param {Number} start start index in parsedPath Array to create sub pathes
	 * @param {Number} end end index (exclusive) for sub path
	 * @return the partial path recreated from parsedPathArray. Path elements in the form "key/id" are returned as {key:id}
	 */
	getSubPath(parsedPathArray, start = 0, end = parsedPathArray.length) {
		if (!Array.isArray(parsedPathArray)) throw new Error("Need array to getSubPath()")
		let result = []
		for (let i = start; i < end; i++) {
			const pathElem = parsedPathArray[i]
			if (typeof pathElem !== "object") throw new Error("ParsedPath elems must be objects: "+JSON.stringify(pathElem))
			else if (pathElem.id !== undefined) result.push({[pathElem.key]: pathElem.id})
			else if (pathElem.index !== undefined) result.push(pathElem.key+"["+pathElem.index+"]")		// index may be 0 !
			else if (pathElem.appendArray === true) result.push(pathElem.key+"[]")
			else if (pathElem.id === undefined && pathElem.index === undefined) result.push(pathElem.key)
			else throw new Error("Invalid parsedPath elem: "+JSON.stringify(pathElem))
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
				if (el.includes("[")) throw new Error(`Cannot convert path with array[index] elements to REST URL: ${el}`)
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
			if (childMetadata.ttl < Date.now()) {
				elem[i] = undefined  // set array element to undefined, but keep array
				metadata[i] = undefined
			} else {
				deleteExpiredElemsRec(elem[i], childMetadata)
			}
		}
	} else if (typeof elem === "object") {
		for (const key in elem) {
			const childMetadata = metadata[key] || {}
			if (childMetadata.ttl < Date.now()) {
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
	// fetchFunc MUST return a Promise, e.g. 
	// `myFetchFunc(path) => { return Promise.resolve(valueFromBackend )}`
	// You can also provide an individual fetchFunc to each `get`call.
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
