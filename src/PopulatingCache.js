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
	 * @param {Object} config configuration options that override the [DEFAULT_CONFIG](#default_config), e.g. `{ fetchFunc, ttl: 30000 }`
	 */
	constructor(config) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.cacheData = {}
		this.cacheMetadata = {}

		// Listeners that will be notified on changes
		this.listeners = []

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
	 * Then `value` is stored as the leaf at the end of path with the given `ttl` or the configured default `ttl`.
	 *
	 * Collections (arrays) have a TTL of their own and one TTL per element:
	 *  - `put("polls", array)` sets the TTL of the collection and of each of its elements.
	 *  - `put("polls/5", poll)`, `put("polls[2]", poll)` or `put("polls[]", poll)` only set the TTL of that one element.
	 *    The TTL of the collection stays untouched.
	 *
	 * @param {String|Array} path path under which the `value` shall be stored in the cache
	 * @param {Any} value The value to store in the cache.
	 * @param {Object} options Override default configuration options, e.g. `ttl` or `merge`
	 * @returns {Object} the cache instance, so that calls to put() can be chained: `myCache.put("foo", "bar").put("foo2", "baz2")`
	 * @throws {Error} when path is invalid, when a scalar value is put under an id, when the id of value does not match the id in path
	 *   or when an array element is put into something that is not an array.
	 */
	put(path, value, options) {
		let cacheElem = this.cacheData
		let metadataElem = this.cacheMetadata
		const opts = { ...this.config, ...options }
		const parsedPath = this.parsePath(path)
		const ttl = Date.now() + opts.ttl

		// Walk along path and insert intermediate objects as necessary
		for (let i = 0; i < parsedPath.length; i++) {
			const { key, id, index, appendArray } = parsedPath[i]
			const isLast = i === parsedPath.length - 1

			// If path[i] is a plain string key
			if (key && index === undefined && id === undefined && !appendArray) {
				if (!isLast) {
					// then step into that key in the cache. Create object if necessary.
					cacheElem    = cacheElem[key]    || (cacheElem[key] = {})
					metadataElem = metadataElem[key] || (metadataElem[key] = {})
				} else {
					// If this is the last element in path, then store value in the cache.
					// If value is an array, then its metadata also has an entry for each element.
					cacheElem[key] = mergeValue(cacheElem[key], value, opts)
					metadataElem[key] = createMetadata(value, opts, ttl)
				}
			}
			// If path[i] was in the form "array[]", then append value to that array
			else if (key && index === undefined && id === undefined && appendArray) {
				if (!isLast) {
					throw new Error('"appendArray[]" is only allowed as the last element of path in PUT()')
					//TODO: Can we allow this in intermediate elements in PUT?
					//  => This is complex! What type of element should I append to the array here? a String,
					//     an object or another array? This depends on the next elem in path
				}
				const array = cachedArray(cacheElem, key, path)
				array.push(value)
				collectionMetadata(metadataElem, key).$elems[array.length - 1] = createElemMetadata(value, opts, ttl)
			}
			// If path[i] is an string that defines an array element "key[index]" then step into it.
			else if (key && index >= 0 && id === undefined) {
				const array = cachedArray(cacheElem, key, path)
				const collection = collectionMetadata(metadataElem, key)
				if (!isLast) {
					cacheElem    = array[index]              || (array[index] = {})
					metadataElem = collection.$elems[index]  || (collection.$elems[index] = {})
				} else {
					// if this is the last element in the path, then set the value as this array element
					array[index] = mergeValue(array[index], value, opts)
					collection.$elems[index] = createElemMetadata(value, opts, ttl)
				}
			}
			// If path[i] is "key/id" or {key:id}, then find the element from "key"-array with a matching _id and step into it.
			else if (key && index === undefined && id !== undefined && !appendArray) {
				if (isLast) {
					// Validate value before we change anything in the cache.
					if (typeof value !== "object")
						throw new Error("You cannot PUT a scalar value under an ID. Must be object with "+opts.idAttr)
					// If value has a different ID than what the last element of path declares, then we cannot store it here.
					// This would break the always valid invariant `cache.put(path, value)  => cache.get(path) = value`
					if (value && value[opts.idAttr] !== undefined && !sameId(value[opts.idAttr], id)) {
						throw new Error(`ID mismatch! You tried to PUT a value under path ${JSON.stringify(path)}.
						  But your value had value.${opts.idAttr}=${value[opts.idAttr]}.`)
					}
				}
				const array = cachedArray(cacheElem, key, path)
				const collection = collectionMetadata(metadataElem, key)
				let idx = findIndexById(array, id, opts.idAttr)
				// If "key"-array does not have an element with that _id, then add a new element to the array.
				if (idx === -1) {
					array.push({ [opts.idAttr]: id })
					idx = array.length - 1
				}
				if (!isLast) {
					cacheElem    = array[idx]
					metadataElem = collection.$elems[idx] || (collection.$elems[idx] = { [opts.idAttr]: array[idx][opts.idAttr] })
				} else {
					if (value && value[opts.idAttr] === undefined) {
						console.warn(`You tried to PUT an object value without an ${opts.idAttr} `+
							`at path ${JSON.stringify(path)}. I added ${opts.idAttr}=${id}`)
						value[opts.idAttr] = id
					}
					array[idx] = mergeValue(array[idx], value, opts)
					collection.$elems[idx] = createElemMetadata(value, opts, ttl, id)
				}
			} else {
				throw Error(`Invalid path element ${i}: ${JSON.stringify(parsedPath[i])}`)
			}
		}
		this.firePutEvent(path, value, parsedPath)
		return this
	}

	/**
	 * Fetch a value from the cache. If the value isn't in the cache or if it is expired,
	 * then the backend will be queried for the value under `path`.
	 *
	 * When the backend is called, then the returned value will again be stored in the cache and its TTL will be updated.
	 *
	 * The most specific TTL wins: An array element expires with its own TTL if it has one (e.g. from `put("polls/5", poll)`),
	 * otherwise with the TTL of its collection (e.g. from `put("polls", array)`). The collection itself only expires with its own TTL.
	 *
	 * With the option `fetchCollection: true`, a missing or expired element `"polls/5"` is not fetched on its own.
	 * Instead `fetchFunc` is called for its whole collection `["polls"]`. The returned array is put into the cache
	 * and the element with the matching id is returned, or `undefined` when the new list does not contain it.
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
	 * @param {Object} options Override default options, e.g. force call to backend, do not populate or fetchCollection.
	 * @returns (A Promise that resolves to) the fetched value. Either directly from the cache or from the backend.
	 * @rejects When the value couldn't be fetched or there was an API error in your backend.
	 */
	async get(path, options) {
		let cacheElem = this.cacheData
		let metadataElem = this.cacheMetadata
		let ttl = undefined     // effective TTL of cacheElem
		const opts = {...this.config, ...options}
		if (typeof opts.fetchFunc !== "function") return Promise.reject("Need fetchFunc to fetch value at path="+JSON.stringify(path))
		const parsedPath = this.parsePath(path)
		const fullPath = this.getSubPath(parsedPath)

		// Walk along parsedPath try to find the value and the end of it.
		for (let i = 0; i < parsedPath.length; i++) {
			const step = stepInto(cacheElem, metadataElem, parsedPath[i], opts.idAttr)
			cacheElem = step.value
			metadataElem = step.metadata
			ttl = step.ttl
			if (i === parsedPath.length - 1) break   // The last element is checked below.

			const subPath = this.getSubPath(parsedPath, 0, i + 1)
			const viaCollection = opts.fetchCollection && parsedPath[i].id !== undefined
			// If there is no intermediate element, then immediately call the backend for the full path.
			// (Unless the missing element can be fetched with its collection.)
			if (!cacheElem && !viaCollection) return this.fetchIfExpired(fullPath, undefined, undefined, opts)

			// If this intermediate element is missing or expired, then fetch it from the backend.
			// This will PUT the returned value back into the cache with an updated TTL.
			if (!cacheElem || isExpired(ttl)) {
				cacheElem = await this.fetchIfExpired(subPath, undefined, { ttl }, opts)
				if (!cacheElem) return undefined   // not in the backend either (or DO_NOT_CALL_BACKEND)
				metadataElem = this.findMetadata(this.parsePath(subPath), opts.idAttr)
			}

			// If cacheElem is a DBref, then (try to) populate it.
			if (opts.populate && cacheElem[opts.referencedPathAttr]) {
				const refPath = cacheElem[opts.referencedPathAttr]  // path to referenced element in the cache
				cacheElem = await this.get(refPath, opts)
				metadataElem = this.findMetadata(this.parsePath(refPath), opts.idAttr)
			}
		}

		// Populate the last element, if it is a DBref and it will not be fetched again anyway.
		if (cacheElem && !isExpired(ttl) && opts.callBackend !== this.FORCE_BACKEND_CALL &&
				opts.populate && cacheElem[opts.referencedPathAttr]) {
			cacheElem = await this.get(cacheElem[opts.referencedPathAttr], opts)
		}

		// Check if cacheElem is expired. Return it or fetch it from the backend if necessary or forced by options
		return this.fetchIfExpired(fullPath, cacheElem, { ttl }, opts)
	}

	/**
	 * This method decides if the backend needs to be called to fetch a given value.
	 * The backend will be called, IF
	 *  - cacheElem is undefined, ie. not yet in the cache
	 *  - cacheElem is expired, because its metadata.ttl is in the past.
	 *  - or when opts.callBackend === FORCE_BACKEND_CALL
	 *
	 * When the backend is called, then the returned value is also PUT() back into the cache
	 * with and updated TTL. With `opts.fetchCollection` an element `"key/id"` is fetched with its whole collection.
	 *
	 * @param {Array} path The full path to cacheElem
	 * @param {Any} cacheElem the leaf element at the end of path or undefined if not in the cache yet
	 * @param {Object} metadata metadata for cacheElem. Only its (effective) `ttl` is used.
	 * @param {Object} opts config options, including fetchFunc
	 * @returns {Promise} resolves to cacheElem if it is not expired. Otherwise tries to query for value with fetchFunc().
	 * @rejects When element is expired and opts.callBackend === DO_NOT_CALL_BACKEND
	 * @private
	 */
	async fetchIfExpired(path, cacheElem, metadata, opts) {
		const expired = metadata ? isExpired(metadata.ttl) : false
		switch(opts.callBackend) {
		case this.FORCE_BACKEND_CALL:
			return this.fetchAndPut(path, opts)
		case this.DO_NOT_CALL_BACKEND:
			if (expired) {
				return Promise.reject(undefined)
			}
			return Promise.resolve(cacheElem)   // cacheElem may also be undefined.
		default:
			if (!cacheElem || expired) {
				return this.fetchAndPut(path, opts)
			} else {
				return Promise.resolve(cacheElem)
			}
		}
	}

	/**
	 * Call `fetchFunc` and PUT the result into the cache. With `opts.fetchCollection` and a path that ends in `"key/id"`,
	 * then fetchFunc is called for the whole collection `key` and the element with that id is returned (or undefined).
	 * @param {Array|String} path path to the value that shall be fetched
	 * @param {Object} opts config options, including fetchFunc
	 * @returns {Promise} resolves to the fetched value
	 * @private
	 */
	async fetchAndPut(path, opts) {
		const parsedPath = this.parsePath(path)
		const last = parsedPath[parsedPath.length - 1]
		if (opts.fetchCollection && last.id !== undefined) {
			const collectionPath = [...this.getSubPath(parsedPath, 0, parsedPath.length - 1), last.key]
			const list = await opts.fetchFunc(collectionPath)
			if (!Array.isArray(list)) {
				throw new Error(`fetchCollection: fetchFunc(${JSON.stringify(collectionPath)}) did not return an array.`)
			}
			this.put(collectionPath, list)
			const idx = findIndexById(list, last.id, opts.idAttr)
			return idx === -1 ? undefined : list[idx]
		}
		const res = await opts.fetchFunc(path)
		this.put(path, res)
		return res
	}

	/**
	 * This is a synchrounous version of get(). getSync() does not return a Promise. It returns the value at path directly
	 * if there is a valid value in the cache.
	 *
	 * getSync() will not call the backend It can only return values that already are in the cache.
	 *
	 * When there is a value in the cache, but it is expired, then there are two possible scenarios:
	 * 1. Simply return undefined to the caller. (This is the default)
	 * 2. Throw an Error. This way the caller can distinguish between "not in the cache at all" or "expired value at that path"
	 *
	 * getSync() can do population, but only with values that already are in the cache.
	 *
	 * @param {String|Array} path path to value in cache
	 * @param {Object} options optionally override configuration options  (callBackend and fetchCollection are ignored in this method.)
	 * @param {Boolean} throwWhenExpired should the method throw when path points to an expired element.
	 *   This way the caller can distinguish between "not in the cache at all" or "expired value at path".
	 * @returns {*} the value from the cache if there is one. (getSync() does not return a Promise, but the value itself.)
	 * @throws {Error} when an element along path is expired and throwWhenExpired = true.
	 *   Otherwise undefined is returned for expired values. Also throws when path is invalid.
	 */
	getSync(path, options, throwWhenExpired = false) {
		let cacheElem = this.cacheData
		let metadataElem = this.cacheMetadata
		const opts = {...this.config, ...options}
		const parsedPath = this.parsePath(path)

		// Walk along path an try to find value at the end of path. (Without calling the backend).
		for (let i = 0; i < parsedPath.length; i++) {
			const step = stepInto(cacheElem, metadataElem, parsedPath[i], opts.idAttr)
			cacheElem = step.value
			metadataElem = step.metadata
			if (!cacheElem) return undefined
			if (isExpired(step.ttl)) {
				if (throwWhenExpired) {
					throw new Error("getSync(): The value at path " + JSON.stringify(path) + "is expired.")
				}	else {
					return undefined
				}
			}
			if (opts.populate && cacheElem[opts.referencedPathAttr]) {
				const refPath = cacheElem[opts.referencedPathAttr]
				cacheElem = this.getSync(refPath, opts, throwWhenExpired)
				metadataElem = this.findMetadata(this.parsePath(refPath), opts.idAttr)
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
	 * @returns {Promise} resolves to the fetched value
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
	 * @returns {Promise} resolves to elem with its DBrefs replaced by the referenced values
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
	 * Subscribe to changes at a given path (or below a path prefix)
	 * 
	 * The listener's onPut(path, value) method will be called, when a value is PUT into the cache.
	 * When a value is deleted, then onPut(path, undefined) is called.
	 * By default listeners are also called when a value is put below the path. 
	 * This can be changed by passing exact = true. Then the listener is only notified, when the value at exactly this path is changed.
	 * 
	 * @param {Any} path path prefix where we listen to changes. If undefined, then listener will be notified for every change of the cache.
	 * @param {Function} onPutFunc callback function that will be notified when a value is put into the cache: onPutFunc(path, value)
	 * @param {Boolean} exact Notify listener only when the value at exactly this path is changed (default=false)
	 * @returns {Object} the listener. Pass it to `unsubscribe(listener)` to stop listening.
	 * @throws {Error} when path is invalid
	 */
	subscribe(path, onPutFunc, exact = false) {
		let parsedPath
		if (path === undefined || path === "" || path === []) {
			// global listener
			parsedPath = []
		} else {
			try {
				parsedPath = this.parsePath(path)
			} catch(err) {
				throw new Error("Cannot subscribe. Path is invalid! " + err)
			}
		}			
		let listener = {
			listenerId: this.listeners.length,
			path: parsedPath,
			onPut: onPutFunc,
			exact: exact
		}
		this.listeners.push(listener)
		return listener
	}

	/**
	 * Stop notifying a listener.
	 * @param {Object} listener the listener as returned by `subscribe()`
	 */
	unsubscribe(listener) {
		let idx = this.listeners.findIndex(el => el.listenerId === listener.listenerId)
		if (idx >= 0) this.listeners.splice(idx, 1)
	}

	/**
	 * Notify matching listeners that a value has been put into the cache.
	 * 
	 * Listeners will be notified with the full path as passed to PUT. A listener might be
	 * subscribed to a higher level node in the tree, ie. to a path prefix.
	 * 
	 * @param {Any} path the path that has changed
	 * @param {Any} value value that has been put into the cache under path
	 * @param {Array} parsedPath internal normalized path array (will be calculated from path when not given)
	 * @private
	 */
	firePutEvent(path, value, parsedPath) {
		if (!parsedPath) parsedPath = this.parsePath(path)
		this.listeners.forEach(l => {
			let match = l.exact === false || parsedPath.length === l.path.length
			// l.path.length can be 0 for global listener!
			for (let i = 0; i < l.path.length && match; i++) {
				if (l.path[i].key !== parsedPath[i].key) match = false
				if (l.path[i].id && l.path[i].id !== parsedPath[i].id) match = false
				if (l.path[i].index && l.path[i].index !== parsedPath[i].index) match = false
			}
			if (match) l.onPut(path, value)
		})
	}

	/**
	 * Delete an element and its metadata from the cache.
	 * If path points to an array element, e.g. `"polls/5"` or `"polls[0]"`, then that array element and its entry in `$elems`
	 * will be set to undefined, so that the length of the array does not change.
	 * Listeners are notified with `onPut(path, undefined)`.
	 * @param {String|Array} path path to the element that shall be deleted
	 * @throws {Error} when path is invalid or ends in "array[]"
	 */
	delete(path) {
		const parsedPath = this.parsePath(path)
		const last = parsedPath[parsedPath.length - 1]
		if (last.appendArray) throw new Error('"array[]" is not allowed in delete(). Delete the whole array or one element of it.')
		let cacheElem = this.cacheData
		let metadataElem = this.cacheMetadata
		for (let i = 0; i < parsedPath.length - 1 && cacheElem; i++) {
			const step = stepInto(cacheElem, metadataElem, parsedPath[i], this.config.idAttr)
			cacheElem = step.value
			metadataElem = step.metadata
		}
		if (cacheElem && typeof cacheElem === "object") {
			if (last.index === undefined && last.id === undefined) {
				delete cacheElem[last.key]
				if (metadataElem) delete metadataElem[last.key]
			} else {
				// Set the array element and its metadata to undefined, so that the length of the array does not change.
				const step = stepInto(cacheElem, metadataElem, last, this.config.idAttr)
				if (step.index !== undefined) {
					cacheElem[last.key][step.index] = undefined
					if (step.collection && Array.isArray(step.collection.$elems)) step.collection.$elems[step.index] = undefined
				}
			}
		}
		this.firePutEvent(path, undefined, parsedPath)
	}
	
	/**
	 * Check if a path points to a defined and not yet expired value in the cache.
	 * If path points to an `undefined` value, then isInCache will return false.
	 * This method will not change the content of the cache or metadata and will not call the backend at all.
	 * (Use `getSync(path)` to fetch the value at a path.)
	 * 
	 * @param {String|Array} path path to an element in the cache
	 * @return {Boolean} true if there is a value !== undefined at that path and it is not yet expired.
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
	 * @returns {Object} the root of the cached data
	 */
	getCacheData() {
		return this.cacheData
	}

	/**
	 * While you `put` values into the cache, Populating-Cache automatically
	 * creates a second parallel tree of metadata next to the `cacheData`.
	 * The metadata contains the time to life (TTL) of the value in the cache.
	 * `ttl` is the number of milliseconds since the epoc, when a value will expire.
	 *
	 * The metadata of a collection (array) has its own `ttl` and `type` and an array `$elems`
	 * with one metadata entry per element, index by index: `{ ttl, type, $elems: [ { _id, ttl, type }, … ] }`.
	 * The names `ttl`, `type` and `$elems` are reserved.
	 *
	 * Returns the metadata node as it is stored, i.e. an element without an own entry or `ttl` has none here.
	 * (`get()` then falls back to the `ttl` of the collection.)
	 *
	 * @param {String|Array} path path to a specific element. If null or undefined, then the metadata of the whole cache is returned.
	 * @returns {Object} metadata of cached value under path, e.g. `{ ttl: 55235325000, type: "number" }`, or undefined
	 */
	getMetadata(path) {
		if (!path) return this.cacheMetadata
		return this.findMetadata(this.parsePath(path), this.config.idAttr)
	}

	/**
	 * Walk along parsedPath through the cache and its metadata in parallel and return the metadata node at the end of it.
	 * @param {Array} parsedPath normalized path as returned by `parsePath()`
	 * @param {String} idAttr name of the id attribute
	 * @returns {Object} metadata node at the end of parsedPath or undefined
	 * @private
	 */
	findMetadata(parsedPath, idAttr) {
		let cacheElem = this.cacheData
		let metadataElem = this.cacheMetadata
		for (let i = 0; i < parsedPath.length; i++) {
			const step = stepInto(cacheElem, metadataElem, parsedPath[i], idAttr)
			cacheElem = step.value
			metadataElem = step.metadata
			if (metadataElem === undefined) return undefined
		}
		return metadataElem
	}

	/**
	 * Completely empty the cache and delete all values in it. This also clears out all metadata.
	 */
	emptyCache() {
		this.cacheData = {}
		this.cacheMetadata = {}
	}

	/**
	 * Recursively walk through the cacheData and delete all expired elements.
	 * You may call this from time to time to optimize the cache's memory consumption.
	 *
	 * Expired array elements and their entries in `$elems` are set to undefined, so that arrays keep their length.
	 * When a collection is expired, then only its elements without a fresh TTL of their own are removed.
	 * If none of them are left, then the collection is deleted completely.
	 */
	deleteExpiredElems() {
		deleteExpiredElemsRec(this.cacheData, this.cacheMetadata)
	}

	// ============ helper methods ==============
	
	/**
	 * Parse a path into a normalized array of `{ key, id, index, appendArray }` objects.
	 * <b>Internally</b> populating-cache uses these normalized pathes.
	 * See README.md for a detailed description about pathes in populating-cache.
	 *
	 * <h3>Elements of normalized path arrray</h3>
	 * {
	 *   "key": the string key of the path,
	 *   "id":  the alphanumerical ID for path elements like "posts/4711",
	 *   "index": numerical array index, eg. from "array[42]"
	 *   "appendArray": boolean, only used for PUT, e.g. put("posts[]", {title: "new post"})
	 * }
	 * 
	 * @param {String|Array} path plain string or array of path elements
	 * @returns {Array} Array of parsed objects { key, id, index, appendArray }. `id` or `index` may be undefind in each path element.
	 * @throws {Error} when path or a path element is invalid
	 */
	parsePath(path) {
		let result = []
		if (!path) throw new Error("Cannot parse empty path.")
		if (typeof path === "string") {
			// If path is just a string, then split it at the dots
			if (path.includes(".")) {
				result = path.split(".")
			} else {
				result = [path]
			}
		} else if (Array.isArray(path)) {
			// If path is an array the create a shallow copy     MUST check for array first!!!
			result = [...path]
		} else if (typeof path === "object" && Object.keys(path).length === 1) {
			// If path is an object in the form { key: value } then create an array with just that one pathElem
			result = [path]
		} else {
			throw new Error("Cannot parse path. Path must be a string, an array or a key-value object.")
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
					key:   match.groups.key,
				}
				if (match.groups.idNum) {
					result[i].id = parseInt(match.groups.idNum)
				} else if (match.groups.id) {
					result[i].id = match.groups.id 
				}
				if (match.groups.index) result[i].index = parseInt(match.groups.index, 10)
				if (match.groups.appendArray === '[]') result[i].appendArray = true   // only used for PUT
			} else if (
				typeof pathElem === "object" &&
				Object.keys(pathElem).length === 1
			) {
				// If path[i] is an object of the form {key: id}
				result[i] = {
					key: Object.keys(pathElem)[0],
					id: Object.values(pathElem)[0],
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
	 * and converts it back to a path as used by `put`, `get` and `fetchFunc`
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
	 * Convert the given path to a REST URL path, e.g. `[{posts: 11}, "comments"]` to `"/posts/11/comments"`.
	 * @param {Array} path a populating-cache path array
	 * @returns {String} the REST URL path
	 * @throws {Error} when path is not an array or contains an "array[index]" element
	 */
	path2rest(path) {
		if (!Array.isArray(path)) throw Error("Path must be an array")
		let restPath = ""
		for (let i = 0; i < path.length; i++) {
			const el = path[i]
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

/**
 * Name of the metadata property of a collection that holds the metadata of its elements, index by index.
 * Together with `ttl` and `type` this is a reserved name in the metadata tree.
 * @private
 */
const ELEMS = "$elems"

/**
 * Two ids are the same, when their string representations are equal. "5" and 5 are the same id.
 * @private
 */
const sameId = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b)

/**
 * A TTL is expired, when it is defined and in the past. Values without a TTL never expire.
 * @private
 */
const isExpired = (ttl) => ttl !== undefined && ttl < Date.now()

/**
 * Index of the element with that id in array, or -1
 * @private
 */
const findIndexById = (array, id, idAttr) => array.findIndex(el => el !== undefined && el !== null && sameId(el[idAttr], id))

/**
 * The effective TTL of an array element: its own TTL, else the TTL of its collection
 * @private
 */
const effectiveTtl = (collectionMeta, elemMeta) => {
	if (elemMeta && elemMeta.ttl !== undefined) return elemMeta.ttl
	return collectionMeta ? collectionMeta.ttl : undefined
}

/**
 * Merge value into oldValue if opts.merge is set and both are (non array) objects
 * @private
 */
const mergeValue = (oldValue, value, opts) => {
	if (opts.merge && value && typeof value === "object" && !Array.isArray(value) && !Array.isArray(oldValue)) {
		return { ...oldValue, ...value }
	}
	return value
}

/**
 * Create the metadata for a value. Arrays also get one entry per element in `$elems`.
 * @private
 */
const createMetadata = (value, opts, ttl) => {
	const metadata = { ttl, type: typeof value }
	if (Array.isArray(value)) metadata[ELEMS] = value.map(el => createElemMetadata(el, opts, ttl))
	return metadata
}

/**
 * Create the metadata entry for an array element. It also contains the element's id, if it has one.
 * @private
 */
const createElemMetadata = (value, opts, ttl, id) => {
	const elemId = value && typeof value === "object" && value[opts.idAttr] !== undefined ? value[opts.idAttr] : id
	const metadata = createMetadata(value, opts, ttl)
	return elemId === undefined ? metadata : { [opts.idAttr]: elemId, ...metadata }
}

/**
 * Get the array under key from the cache. Create it if necessary. Throws if there is something else under key.
 * @private
 */
const cachedArray = (cacheParent, key, path) => {
	if (cacheParent[key] === undefined || cacheParent[key] === null) cacheParent[key] = []
	if (!Array.isArray(cacheParent[key])) {
		throw new Error(`Cannot PUT ${JSON.stringify(path)}. "${key}" in the cache is not an array.`)
	}
	return cacheParent[key]
}

/**
 * Get the metadata node of a collection under key. Create it as `{ $elems: [] }` (without an own TTL) if necessary.
 * An existing TTL of the collection is kept.
 * @private
 */
const collectionMetadata = (metadataParent, key) => {
	let node = metadataParent[key]
	if (!node || typeof node !== "object" || Array.isArray(node)) {
		node = metadataParent[key] = { [ELEMS]: [] }
	} else if (!Array.isArray(node[ELEMS])) {
		node[ELEMS] = []
	}
	return node
}

/**
 * Step one level down in the cache and in the parallel metadata tree. This does not change anything.
 * @param {Any} cacheElem current element in the cache
 * @param {Object} metadataElem metadata node of cacheElem (may be undefined)
 * @param {Object} pathElem one element of a parsed path: { key, id, index }
 * @param {String} idAttr name of the id attribute
 * @returns {Object} `{ value, metadata, ttl, index, collection }`
 *   - value: the child element (undefined if not in the cache)
 *   - metadata: the child's own metadata node
 *   - ttl: the child's effective TTL. For array elements its own ttl, else the ttl of its collection.
 *   - index: the array index of the child (only for array elements)
 *   - collection: the metadata node of the collection (only for array elements)
 * @private
 */
const stepInto = (cacheElem, metadataElem, pathElem, idAttr) => {
	const { key, id, index } = pathElem
	if (cacheElem === undefined || cacheElem === null) return {}
	const parentMeta = metadataElem && typeof metadataElem === "object" ? metadataElem : undefined
	if (index === undefined && id === undefined) {
		const metadata = parentMeta ? parentMeta[key] : undefined
		return { value: cacheElem[key], metadata, ttl: metadata ? metadata.ttl : undefined }
	}
	const array = cacheElem[key]
	const collection = parentMeta ? parentMeta[key] : undefined
	if (!Array.isArray(array)) return { collection }
	const idx = id !== undefined ? findIndexById(array, id, idAttr) : index
	if (idx < 0 || idx >= array.length) return { collection }
	const metadata = collection && Array.isArray(collection[ELEMS]) ? collection[ELEMS][idx] : undefined
	return { value: array[idx], metadata, ttl: effectiveTtl(collection, metadata), index: idx, collection }
}

/**
 * Recursively delete expired elements.
 * An expired array element is set to undefined (the array keeps its length) and so is its entry in `$elems`.
 * When a collection is expired, then only its elements without a fresh TTL of their own are removed.
 * If none of its elements are left, then the collection is deleted completely.
 * @private
 */
let deleteExpiredElemsRec = function(elem, metadata) {
	if (!elem || typeof elem !== "object" || !metadata || typeof metadata !== "object") return
	if (Array.isArray(elem)) {
		const elems = Array.isArray(metadata[ELEMS]) ? metadata[ELEMS] : []
		for (let i = 0; i < elem.length; i++) {
			const elemMeta = elems[i]
			if (isExpired(effectiveTtl(metadata, elemMeta))) {
				elem[i] = undefined  // set array element to undefined, but keep array
				if (elemMeta) elems[i] = undefined
			} else {
				deleteExpiredElemsRec(elem[i], elemMeta)
			}
		}
	} else {
		for (const key in elem) {
			const childMetadata = metadata[key]
			if (!childMetadata) continue
			if (Array.isArray(elem[key])) {
				// Elements with a fresh TTL of their own outlive their expired collection.
				deleteExpiredElemsRec(elem[key], childMetadata)
				if (isExpired(childMetadata.ttl) && elem[key].every(el => el === undefined)) {
					delete elem[key]
					delete metadata[key]
				}
			} else if (isExpired(childMetadata.ttl)) {
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
 * See [Configuration](#configuration) for a description of all options.
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

	// When an element "key/id" must be fetched from the backend, then fetch its whole collection instead:
	// fetchFunc(["key"]) is called, the returned array is PUT into the cache and the element with that id is returned.
	fetchCollection: false,

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
 * The pathElem will be split into the following tokens:
 * First a  key. Must start with a letter, underscore or dollar. Then further leters, numbers, underscore, dollar or hyphen(-), 
 * e.g.  "foo", "$bar", "_foo42" or "b535-dd434-dd532", but not ".abc"
 * 
 * Then three optional parts
 *  - index: number in square brackts, e.g. "[42]""
 *  - appendArray: two square brackets without a numbe: "[]"
 *  - id: alphanumerical ID, e.g. "034de-3335-ff35" or "ADD3XU"
 *  - idNum: numerical ID, eg  "4325"
 * @private
 */
// eslint-disable-next-line max-len
const pathElemRegEx = /^(?<key>[a-zA-Z_$][0-9a-zA-Z-_$]*)((\[(?<index>\d+)\])|(?<appendArray>\[\])|(\/(?<idNum>[0-9]+))|(\/(?<id>[0-9a-zA-Z_$][0-9a-zA-Z-_$]*)))?$/



export default PopulatingCache
