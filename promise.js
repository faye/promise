'use strict'

const PENDING   = -1
const FULFILLED =  0
const REJECTED  =  1

class AggregateError extends Error {
  name = 'AggregateError'

  constructor (errors, options) {
    super('All promises were rejected', options)
    this.errors = errors
  }
}

class Promise {
  constructor (task) {
    this._state = PENDING
    this._value = null
    this._defer = []

    execute(this, task)
  }

  then (onFulfilled, onRejected) {
    let promise = new Promise()
    let deferred = { promise, onFulfilled, onRejected }

    if (this._state === PENDING) {
      this._defer.push(deferred)
    } else {
      propagate(this, deferred)
    }

    return promise
  }

  catch (onRejected) {
    return this.then(null, onRejected)
  }

  finally (onFinally) {
    return this.then((value) => {
      return Promise.try(onFinally).then(() => value)
    }, (reason) => {
      return Promise.try(onFinally).then(() => Promise.reject(reason))
    })
  }

  static resolve (value) {
    try {
      if (getThen(value)) return value
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => resolve(value))
  }

  static reject (reason) {
    return new Promise((resolve, reject) => reject(reason))
  }

  static try (func, ...args) {
    try {
      let result = func(...args)
      return Promise.resolve(result)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  static allSettled (promises) {
    return new Promise((resolve, reject) => {
      let results = []
      let n = promises.length

      if (n === 0) return resolve(results)

      for (let [i, promise] of promises.entries()) {
        Promise.resolve(promise).then((value) => {
          results[i] = { status: 'fulfilled', value }
          if (--n === 0) resolve(results)
        }, (reason) => {
          results[i] = { status: 'rejected', reason }
          if (--n === 0) resolve(results)
        })
      }
    })
  }

  static all (promises) {
    return new Promise((resolve, reject) => {
      let results = []
      let n = promises.length

      if (n === 0) return resolve(results)

      for (let [i, promise] of promises.entries()) {
        Promise.resolve(promise).then((value) => {
          results[i] = value
          if (--n === 0) resolve(results)
        }, reject)
      }
    })
  }

  static any (promises) {
    return new Promise((resolve, reject) => {
      let errors = []
      let n = promises.length

      if (n === 0) return reject(new AggregateError([]))

      for (let [i, promise] of promises.entries()) {
        Promise.resolve(promise).then(resolve, (reason) => {
          errors[i] = reason
          if (--n === 0) reject(new AggregateError(errors))
        })
      }
    })
  }

  static race (promises) {
    return new Promise((resolve, reject) => {
      for (let promise of promises) {
        Promise.resolve(promise).then(resolve, reject)
      }
    })
  }

  static withResolvers () {
    let tuple = null

    let promise = new Promise((resolve, reject) => {
      tuple = { resolve, reject }
    })

    tuple.promise = promise
    return tuple
  }
}

function execute (promise, task) {
  if (typeof task !== 'function') return

  let calls = 0

  let resolvePromise = (value) => {
    if (calls++ === 0) resolve(promise, value)
  }

  let rejectPromise = (reason) => {
    if (calls++ === 0) reject(promise, reason)
  }

  try {
    task(resolvePromise, rejectPromise)
  } catch (error) {
    rejectPromise(error)
  }
}

function propagate (promise, deferred) {
  let { _state, _value } = promise
  let { promise: next, onFulfilled, onRejected } = deferred
  let handler = [onFulfilled, onRejected][_state]
  let pass = [resolve, reject][_state]

  if (typeof handler !== 'function') {
    return pass(next, _value)
  }

  queueMicrotask(() => {
    try {
      resolve(next, handler(_value))
    } catch (error) {
      reject(next, error)
    }
  })
}

function resolve (promise, value) {
  if (promise === value) {
    return reject(promise, new TypeError('Recursive promise chain detected'))
  }

  let then = null

  try {
    then = getThen(value)
  } catch (error) {
    return reject(promise, error)
  }

  if (!then) return fulfill(promise, value)

  execute(promise, (resolvePromise, rejectPromise) => {
    then.call(value, resolvePromise, rejectPromise)
  })
}

function getThen (value) {
  let type = typeof value
  let then = (type === 'object' || type === 'function') && value && value.then

  return (typeof then === 'function') ? then : null
}

function fulfill (promise, value) {
  settle(promise, FULFILLED, value)
}

function reject (promise, reason) {
  settle(promise, REJECTED, reason)
}

function settle (promise, state, value) {
  let defer = promise._defer

  promise._state = state
  promise._value = value
  promise._defer = null

  for (let next of defer) {
    propagate(promise, next)
  }
}

module.exports = {
  Promise,
 
  deferred () {
    return Promise.withResolvers()
  }
}
