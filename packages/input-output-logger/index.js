import { jsonSafeParse, jsonSafeStringify } from '@middy/util'
import InvalidLoggerException from './invalid-logger.exception'

const defaults = {
  logger: console.log,
  awsContext: false,
  omitPaths: [],
  replacer: undefined
}

const inputOutputLoggerMiddleware = (opts = {}) => {
  const { logger, awsContext, omitPaths, replacer } = { ...defaults, ...opts }

  assertValidLogger(logger)

  const omitPathTree = buildPathOmitTree(omitPaths)
  const omitAndLog = (param, request) => {
    const message = { [param]: request[param] }

    if (awsContext) {
      message.context = pick(request.context, awsContextKeys)
    }

    const cloneMessage = jsonSafeParse(jsonSafeStringify(message, replacer)) // Full clone to prevent nested mutations
    omit(cloneMessage, { [param]: omitPathTree[param] })

    logger(cloneMessage)
  }

  const inputOutputLoggerMiddlewareBefore = async (request) => omitAndLog('event', request)
  const inputOutputLoggerMiddlewareAfter = async (request) => omitAndLog('response', request)
  const inputOutputLoggerMiddlewareOnError = async (request) => {
    if (request.response === undefined) return
    return omitAndLog('response', request)
  }

  return {
    before: inputOutputLoggerMiddlewareBefore,
    after: inputOutputLoggerMiddlewareAfter,
    onError: inputOutputLoggerMiddlewareOnError
  }
}

const assertValidLogger = (logger) => {
  if (typeof logger !== 'function') {
    throw new InvalidLoggerException()
  }
}

// https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html
const awsContextKeys = [
  'functionName',
  'functionVersion',
  'invokedFunctionArn',
  'memoryLimitInMB',
  'awsRequestId',
  'logGroupName',
  'logStreamName',
  'identity',
  'clientContext',
  'callbackWaitsForEmptyEventLoop'
]

// move to util, if ever used elsewhere
const pick = (originalObject = {}, keysToPick = []) => {
  const newObject = {}
  for (const path of keysToPick) {
    // only supports first level
    if (originalObject[path] !== undefined) {
      newObject[path] = originalObject[path]
    }
  }
  return newObject
}

const buildPathOmitTree = (paths) => {
  const tree = {}
  for (let path of paths.sort().reverse()) { // reverse to ensure conflicting paths don't cause issues
    if (!Array.isArray(path)) path = path.split('.')
    if (path.includes('__proto__')) continue
    path
      .slice(0) // clone
      .reduce((a, b, idx) => {
        if (idx < path.length - 1) {
          a[b] ??= {}
          return a[b]
        }
        a[b] = true
        return true
      }, tree)
  }
  return tree
}

const omit = (obj, pathTree = {}) => {
  if (Array.isArray(obj) && pathTree['[]']) {
    for (const value of obj) {
      omit(value, pathTree['[]'])
    }
  } else if (isObject(obj)) {
    for (const key in pathTree) {
      if (pathTree[key] === true) {
        delete obj[key]
      } else {
        omit(obj[key], pathTree[key])
      }
    }
  }
}

const isObject = (value) => value && typeof value === 'object' && value.constructor === Object

export default inputOutputLoggerMiddleware
