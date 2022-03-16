// Not implemented: https://developer.mozilla.org/en-US/docs/Web/API/StorageEvent

key = `apify.container.${key}.`;

if (location.href.endsWith('pleaseNoIntercept')) {
	return;
}

const {
	String,
	Array,
	Set,
	TypeError,
	Map,
	WeakMap,
	Object,
	Number,
	Function,
	Proxy,
	IDBFactory,
	IDBDatabase,
	StorageEvent,
	BroadcastChannel,
	Storage,
	localStorage,
	sessionStorage,
} = globalThis;

const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectCreate = Object.create;
const ObjectEntries = Object.entries;
const ReflectGet = Reflect.get;
const ReflectSet = Reflect.set;
const ObjectKeys = Object.keys;
const NumberIsFinite = Number.isFinite;
const MapIteratorPrototypeNext = (new Map()).keys().next;

const clonePrototype = (from) => {
	const target = ObjectCreate(null);
	const prototype = ObjectGetOwnPropertyDescriptors(from.prototype);

	for (const [name, descriptor] of ObjectEntries(prototype)) {
		target[name] = ObjectCreate(null);

		if ('get' in descriptor) {
			target[name].get = descriptor.get;
		}

		if ('set' in descriptor) {
			target[name].set = descriptor.set;
		}

		if ('value' in descriptor) {
			target[name] = descriptor.value;
		}
	}

	return target;
};

const fixStack = (error) => {
	const lines = StringPrototype.split.call(error.stack, '\n');
	ArrayPrototype.splice.call(lines, 1, 1);
	error.stack = ArrayPrototype.join.call(lines, '\n');

	return error;
};

const MapPrototype = clonePrototype(Map);
const WeakMapPrototype = clonePrototype(WeakMap);
const ArrayPrototype = clonePrototype(Array);
const StringPrototype = clonePrototype(String);
const IDBFactoryPrototype = clonePrototype(IDBFactory);
const IDBDatabasePrototype = clonePrototype(IDBDatabase);
const StoragePrototype = clonePrototype(Storage);

const privates = new WeakMap();

let invocable = false;

const FakeStorage = class Storage {
	constructor(...args) {
		if (invocable) {
			throw fixStack(new TypeError('Illegal constructor'));
		}

		WeakMapPrototype.set.call(privates, this, args[0]);
	}

	get length() {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		const length = StoragePrototype.length.get.call(storage);
		let fakeLength = 0;
		for (let i = 0; i < length; i++) {
			const storageKey = StoragePrototype.key.call(storage, i);
			if (StringPrototype.startsWith.call(storageKey, key)) {
				fakeLength++;
			}
		}
		return fakeLength;
	}

	clear() {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		const length = StoragePrototype.length.get.call(storage);
		const keys = [];

		for (let i = 0; i < length; i++) {
			ArrayPrototype.push.call(keys, StoragePrototype.key.call(storage, i));
		}

		for (let i = 0; i < length; i++) {
			const storageKey = keys[i];
			if (StringPrototype.startsWith.call(storageKey, key)) {
				StoragePrototype.removeItem.call(storage, storageKey);
			}
		}
	}

	key(...args) {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		if (args.length === 0) {
			throw fixStack(new TypeError(`Failed to execute 'key' on 'Storage': 1 argument required, but only 0 present.`));
		}

		const x = NumberIsFinite(args[0]) ? args[0] : 0;

		const length = StoragePrototype.length.get.call(storage);
		let fakeLength = 0;
		for (let i = 0; i < length; i++) {
			const storageKey = StoragePrototype.key.call(storage, i);
			if (StringPrototype.startsWith.call(storageKey, key)) {
				if (fakeLength === x) {
					return StringPrototype.slice.call(storageKey, key.length);
				}
				fakeLength++;
			}
		}
		return null;
	}

	getItem(...args) {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		if (args.length === 0) {
			throw fixStack(new TypeError(`Failed to execute 'getItem' on 'Storage': 1 argument required, but only 0 present.`));
		}
		return StoragePrototype.getItem.call(storage, key + args[0]);
	}

	removeItem(...args) {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		if (args.length === 0) {
			throw fixStack(new TypeError(`Failed to execute 'removeItem' on 'Storage': 1 argument required, but only 0 present.`));
		}
		StoragePrototype.removeItem.call(storage, key + args[0]);
	}

	setItem(...args) {
		const storage = WeakMapPrototype.get.call(privates, this);
		if (!storage) {
			throw fixStack(new TypeError('Illegal invocation'));
		}
		if (args.length === 0 || args.length === 1) {
			throw fixStack(new TypeError(`Failed to execute 'setItem' on 'Storage': 2 arguments required, but only ${args.length} present.`));
		}
		StoragePrototype.setItem.call(storage, key + args[0], args[1]);
	}
};

const FakeStoragePrototype = clonePrototype(FakeStorage);

const createStorage = (underlyingStorage) => {
	invocable = false;
	const storage = new FakeStorage(underlyingStorage);
	invocable = true;

	const map = WeakMapPrototype.get.call(privates, storage);

	const proxy = new Proxy(storage, {
		// Default:
		// apply: (target, thisArg, args) => {},
		// construct(target, args) => {},
		// setPrototypeOf: (target, proto) => {},
		// getPrototypeOf: (target) => {},
		defineProperty: (target, key, descriptor) => {
			if ('set' in descriptor || 'get' in descriptor) {
				throw fixStack(new TypeError(`Failed to set a named property on 'Storage': Accessor properties are not allowed.`));
			}

			FakeStoragePrototype.setItem.call(target, key, descriptor.value);
		},
		deleteProperty: (target, key) => {
			FakeStoragePrototype.removeItem.call(target, key);
		},
		get: (target, key) => {
			if (!(key in target)) {
				return FakeStoragePrototype.getItem.call(target, key);
			}

			return ReflectGet(target, key);
		},
		getOwnPropertyDescriptor: (target, key) => {
			if (key in target) {
				return ObjectGetOwnPropertyDescriptor(ObjectGetPrototypeOf(target), key);
			}

			const value = FakeStoragePrototype.getItem.call(target, key);

			if (value !== null) {
				return {
					value,
					writable: true,
					enumerable: true,
					configurable: true,
				};
			}
		},
		has: (target, key) => {
			const value = FakeStoragePrototype.getItem.call(target, key);

			return (value !== null) || (key in target);
		},
		isExtensible: (target) => {
			return true;
		},
		ownKeys: (target) => {
			const keys = [];

			const storage = WeakMapPrototype.get.call(privates, target);
			const length = StoragePrototype.length.get.call(storage);
			for (let i = 0; i < length; i++) {
				const storageKey = StoragePrototype.key.call(storage, i);
				if (StringPrototype.startsWith.call(storageKey, key)) {
					ArrayPrototype.push.call(keys, StringPrototype.slice.call(storageKey, key.length));
				}
			}

			return [...new Set([...keys, ...ObjectKeys(target)])];
		},
		preventExtensions: (target) => {
			throw fixStack(new TypeError(`Cannot prevent extensions`));
		},
		set: (target, key, value) => {
			if (key in target) {
				return ReflectSet(target, key, value);
			}

			return FakeStoragePrototype.setItem.call(target, key, value) ?? true;
		},
	});

	privates.set(proxy, privates.get(storage));

	return proxy;
};

const fakeLocalStorage = createStorage(localStorage);
const fakeSessionStorage = createStorage(sessionStorage);

const getLocalStorage = function localStorage() { return fakeLocalStorage; };
const getSessionStorage = function sessionStorage() { return fakeSessionStorage; };

ObjectDefineProperty(window, 'Storage', {
	value: FakeStorage,
	configurable: true,
	enumreable: false,
	writable: true,
});
ObjectDefineProperty(window, 'localStorage', {
	configurable: true,
	enumerable: true,
	get: getLocalStorage,
	set: undefined,
});
ObjectDefineProperty(window, 'sessionStorage', {
	configurable: true,
	enumerable: true,
	get: getSessionStorage,
	set: undefined,
});

const toHide = new WeakMap();
WeakMapPrototype.set.call(toHide, FakeStorage, 'Storage');
WeakMapPrototype.set.call(toHide, FakeStoragePrototype.key, 'key');
WeakMapPrototype.set.call(toHide, FakeStoragePrototype.getItem, 'getItem');
WeakMapPrototype.set.call(toHide, FakeStoragePrototype.setItem, 'setItem');
WeakMapPrototype.set.call(toHide, FakeStoragePrototype.removeItem, 'removeItem');
WeakMapPrototype.set.call(toHide, FakeStoragePrototype.clear, 'clear');
WeakMapPrototype.set.call(toHide, getLocalStorage, 'get localStorage');
WeakMapPrototype.set.call(toHide, getSessionStorage, 'get sessionStorage');

for (const Type of [ Function, Object, Array ]) {
	const create = (fallback) => function() {
		if (this instanceof FakeStorage) {
			return '[object Storage]';
		}

		if (WeakMapPrototype.has.call(toHide, this)) {
			return `function ${WeakMapPrototype.get.call(toHide, this)}() { [native code] }`;
		}

		return fallback.call(this);
	};

	const toString = create(Type.prototype.toString);
	const toLocaleString = create(Type.prototype.toLocaleString);

	WeakMapPrototype.set.call(toHide, toString, 'toString');
	WeakMapPrototype.set.call(toHide, toLocaleString, 'toLocaleString');

	Object.defineProperty(Type.prototype, 'toString', {
		value: toString,
	});
	Object.defineProperty(Type.prototype, 'toLocaleString', {
		value: toLocaleString,
	});
}

const { Document, document } = globalThis;

const realGetCookie = ObjectGetOwnPropertyDescriptor(Document.prototype, 'cookie').get;
const realSetCookie = ObjectGetOwnPropertyDescriptor(Document.prototype, 'cookie').set;

const getCookie = function cookie() {
	try {
		const cookies = StringPrototype.split.call(realGetCookie.call(this), '; ');
		const filtered = ArrayPrototype.filter.call(cookies, (cookie) => StringPrototype.startsWith.call(cookie, key));
		const mapped = ArrayPrototype.map.call(filtered, (cookie) => {
			const result = StringPrototype.slice.call(cookie, key.length);
			if (result[0] === '=') {
				return StringPrototype.slice.call(result, 1);
			}
			return result;
		});
		return ArrayPrototype.join.call(mapped, '; ');
	} catch (error) {
		throw fixStack(error);
	}
};

const setCookie = function cookie(cookieString) {
	cookieString = StringPrototype.trimStart.call(String(cookieString));

	const delimiterIndex = StringPrototype.indexOf.call(cookieString, ';');
	const equalsIndex = StringPrototype.indexOf.call(cookieString, '=')
	if ((equalsIndex === -1) || ((delimiterIndex !== -1) && (equalsIndex > delimiterIndex))) {
		cookieString = '=' + cookieString;
	}

	try {
		realSetCookie.call(this, key + cookieString);
	} catch (error) {
		throw fixStack(error);	
	}
};

WeakMapPrototype.set.call(toHide, getCookie, 'get cookie');
WeakMapPrototype.set.call(toHide, setCookie, 'set cookie');

ObjectDefineProperty(Document.prototype, 'cookie', {
	configurable: true,
	enumerable: true,
	get: getCookie,
	set: setCookie,
});

const openDatabase = function open(name) {
	try {
		return IDBFactoryPrototype.open.call(this, key + name);
	} catch (error) {
		throw fixStack(error);
	}
};

const deleteDatabase = function deleteDatabase(name) {
	try {
		return IDBFactoryPrototype.deleteDatabase.call(this, key + name);
	} catch (error) {
		throw fixStack(error);
	}
};

const databaseName = function name() {
	try {
		return StringPrototype.slice.call(IDBDatabasePrototype.name.get.call(this), key.length);
	} catch (error) {
		throw fixStack(error);
	}
};

WeakMapPrototype.set.call(toHide, openDatabase, 'open');
WeakMapPrototype.set.call(toHide, deleteDatabase, 'deleteDatabase');
WeakMapPrototype.set.call(toHide, databaseName, 'get name');

ObjectDefineProperty(IDBFactory.prototype, 'open', {
	writable: true,
	configurable: true,
	enumerable: true,
	value: openDatabase,
});
ObjectDefineProperty(IDBFactory.prototype, 'deleteDatabase', {
	writable: true,
	configurable: true,
	enumerable: true,
	value: deleteDatabase,
});
ObjectDefineProperty(IDBDatabase.prototype, 'name', {
	configurable: true,
	enumerable: true,
	get: databaseName,
	set: undefined,
});

ObjectDefineProperty(window, 'BroadcastChannel', {
	configurable: true,
	enumerable: false,
	writable: true,
	value: new Proxy(BroadcastChannel, {
		construct: (Target, name) => {
			return new Target(key + name);
		},
	}),
});

WeakMapPrototype.set.call(toHide, window.BroadcastChannel, 'BroadcastChannel');

const getBroadcastChannelName = ObjectGetOwnPropertyDescriptor(BroadcastChannel.prototype, 'name').get;
const broadcastChannelName = function name() {
	try {
		const realName = getBroadcastChannelName.call(this);
		if (StringPrototype.startsWith.call(realName, key)) {
			return StringPrototype.slice.call(realName, key.length);
		}
		return realName;
	} catch (error) {
		throw fixStack(error);
	}
};

WeakMapPrototype.set.call(toHide, broadcastChannelName, 'get name');

ObjectDefineProperty(BroadcastChannel.prototype, 'name', {
	configurable: true,
	enumerable: true,
	get: broadcastChannelName,
	set: undefined,
});

