import deferred from '@redux-saga/deferred'
import * as is from '@redux-saga/is'
import { TASK, TASK_CANCEL } from '@redux-saga/symbols'
import { assignWithSymbols, check, createSetContextWarning } from './utils'
import { addSagaStack, sagaStackToString } from './error-utils'
import forkQueue from './forkQueue'

export default function newTask(env, mainTask, parentContext, parentEffectId, meta, isRoot, cont) {
  let _isRunning = true
  let _isCancelled = false
  let _isAborted = false
  let _result
  let _error
  let _deferredEnd = null

  const cancelledDueToErrorTasks = []

  const context = Object.create(parentContext)
  const queue = forkQueue(
    mainTask,
    function onAbort() {
      cancelledDueToErrorTasks.push(...queue.getTaskNames())
    },
    end,
  )

  /**
   This may be called by a parent generator to trigger/propagate cancellation
   cancel all pending tasks (including the main task), then end the current task.

   Cancellation propagates down to the whole execution tree holded by this Parent task
   It's also propagated to all joiners of this task and their execution tree/joiners

   Cancellation is noop for terminated/Cancelled tasks tasks
   **/
  function cancel() {
    // We need to check both Running and Cancelled status
    // Tasks can be Cancelled but still Running
    if (_isRunning && !_isCancelled) {
      _isCancelled = true
      queue.cancelAll()
      // Ending with a TASK_CANCEL will propagate the Cancellation to all joiners
      end(TASK_CANCEL)
    }
  }

  function end(result, isErr) {
    _isRunning = false

    if (!isErr) {
      _result = result
      _deferredEnd && _deferredEnd.resolve(result)
    } else {
      addSagaStack(result, {
        meta,
        effect: task.crashedEffect,
        cancelledTasks: cancelledDueToErrorTasks,
      })

      if (task.isRoot) {
        if (result && result.sagaStack) {
          result.sagaStack = sagaStackToString(result.sagaStack)
        }

        if (env.onError) {
          env.onError(result)
        }
        if (env.logError) {
          // TODO: could we skip this when _deferredEnd is attached?
          env.logError(result)
        }
      }
      _error = result
      _isAborted = true
      _deferredEnd && _deferredEnd.reject(result)
    }
    task.cont(result, isErr)
    task.joiners.forEach(j => j.cb(result, isErr))
    task.joiners = null
  }

  function setContext(props) {
    if (process.env.NODE_ENV !== 'production') {
      check(props, is.object, createSetContextWarning('task', props))
    }

    assignWithSymbols(context, props)
  }

  function toPromise() {
    if (_deferredEnd) {
      return _deferredEnd.promise
    }

    const def = deferred()
    _deferredEnd = def

    if (!_isRunning) {
      if (_isAborted) {
        def.reject(_error)
      } else {
        def.resolve(_result)
      }
    }

    return def.promise
  }

  const task = {
    // fields
    [TASK]: true,
    id: parentEffectId,
    mainTask,
    meta,
    isRoot,
    context,
    joiners: [],
    queue,
    crashedEffect: null,

    // methods
    cancel,
    cont,
    end,
    setContext,
    toPromise,
    isRunning: () => _isRunning,
    isCancelled: () => _isCancelled,
    isAborted: () => _isAborted,
    result: () => _result,
    error: () => _error,
  }

  return task
}
