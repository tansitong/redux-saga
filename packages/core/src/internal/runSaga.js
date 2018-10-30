import * as is from '@redux-saga/is'
import { compose } from 'redux'
import { check, uid as nextSagaId, wrapSagaDispatch, noop, log as _log } from './utils'
import proc, { getMetaInfo } from './proc'
import { stdChannel } from './channel'
import { immediately } from './scheduler'

const RUN_SAGA_SIGNATURE = 'runSaga(options, saga, ...args)'
const NON_GENERATOR_ERR = `${RUN_SAGA_SIGNATURE}: saga argument must be a Generator function!`

export function runSaga(options, saga, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    check(saga, is.func, NON_GENERATOR_ERR)
  }

  const iterator = saga(...args)

  if (process.env.NODE_ENV !== 'production') {
    check(iterator, is.iterator, NON_GENERATOR_ERR)
  }

  const {
    channel = stdChannel(),
    dispatch,
    getState,
    context = {},
    sagaMonitor,
    logger = _log,
    effectMiddlewares,
    onError = function logError(err) {
      logger('error', err)
      if (err && err.sagaStack) {
        logger('error', err.sagaStack)
      }
    },
  } = options

  const effectId = nextSagaId()

  if (sagaMonitor) {
    // monitors are expected to have a certain interface, let's fill-in any missing ones
    sagaMonitor.rootSagaStarted = sagaMonitor.rootSagaStarted || noop
    sagaMonitor.effectTriggered = sagaMonitor.effectTriggered || noop
    sagaMonitor.effectResolved = sagaMonitor.effectResolved || noop
    sagaMonitor.effectRejected = sagaMonitor.effectRejected || noop
    sagaMonitor.effectCancelled = sagaMonitor.effectCancelled || noop
    sagaMonitor.actionDispatched = sagaMonitor.actionDispatched || noop

    sagaMonitor.rootSagaStarted({ effectId, saga, args })
  }

  if (process.env.NODE_ENV !== 'production' && is.notUndef(effectMiddlewares)) {
    const MIDDLEWARE_TYPE_ERROR = 'effectMiddlewares must be an array of functions'
    check(effectMiddlewares, is.array, MIDDLEWARE_TYPE_ERROR)
    effectMiddlewares.forEach(effectMiddleware => check(effectMiddleware, is.func, MIDDLEWARE_TYPE_ERROR))
  }

  if (process.env.NODE_ENV !== 'production') {
    if (is.notUndef(onError)) {
      check(onError, is.func, 'onError must be a function')
    }
  }

  const middleware = effectMiddlewares && compose(...effectMiddlewares)
  const finalizeRunEffect = runEffect => {
    if (is.func(middleware)) {
      return function finalRunEffect(effect, effectId, currCb) {
        const plainRunEffect = eff => runEffect(eff, effectId, currCb)
        return middleware(plainRunEffect)(effect)
      }
    } else {
      return runEffect
    }
  }

  const env = {
    stdChannel: channel,
    dispatch: wrapSagaDispatch(dispatch),
    getState,
    sagaMonitor,
    onError,
    finalizeRunEffect,
  }

  return immediately(() => {
    const task = proc(env, iterator, context, effectId, getMetaInfo(saga), /* isRoot */ true, noop)

    if (sagaMonitor) {
      sagaMonitor.effectResolved(effectId, task)
    }

    return task
  })
}
