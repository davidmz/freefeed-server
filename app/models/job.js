import createDebug from 'debug';
import Raven from 'raven';
import config from 'config'


const sentryIsEnabled = 'sentryDsn' in config;
const debug = createDebug('freefeed:jobs:debug');
const debugError = createDebug('freefeed:jobs:errors');

export const ANY_JOB = Symbol('ANY_JOB');

export function addJobModel(dbAdapter) {
  return class Job {
    id;
    createdAt;
    unlockAt;
    name;
    payload;
    attempts;

    constructor(params) {
      for (const f of Object.keys(this)) {
        if (f in params) {
          this[f] = params[f];
        }
      }
    }

    /**
     * Create and place a new job
     *
     * @param {string} name
     * @param {any} payload
     * @param {object} params
     * @returns {Promise<Job>}
     */
    static create(name, payload = {}, { unlockAt = 0 } = {}) {
      _checkUnlockAtType(unlockAt);
      return dbAdapter.createJob(name, payload, { unlockAt });
    }

    static getById(id) {
      return dbAdapter.getJobById(id);
    }

    /**
     * @returns {Promise<void>}
     */
    async setUnlockAt(unlockAt = 0) {
      _checkUnlockAtType(unlockAt);
      const modified = await dbAdapter.setJobUnlockAt(this.id, unlockAt);
      this.unlockAt = modified.unlockAt;
    }

    /**
     * Delete job. The job handler must call this method when the job is
     * processed.
     * @returns {Promise<void>}
     */
    delete() {
      return dbAdapter.deleteJob(this.id);
    }
  }
}

export function addJobManagerModel(dbAdapter) {
  return class JobManager {
    pollInterval;
    jobLockTime;
    batchSize;

    _pollTimer = null;
    _handlers = new Map();
    _completeEvents = new PicoEvents(ANY_JOB);
    _failureEvents = new PicoEvents(ANY_JOB);

    constructor({
      pollInterval = 5, // 5 sec
      jobLockTime = 120, // 2 min
      batchSize = 5,
    } = {}) {
      this.pollInterval = pollInterval;
      this.jobLockTime = jobLockTime;
      this.batchSize = batchSize;
    }

    startPolling() {
      debug('starting polling');
      this._pollTimer = setInterval(
        () => this.fetchAndProcess().catch((err) => {
          debugError('cannot fetch jobs', err);

          if (sentryIsEnabled) {
            Raven.captureException(err, { extra: { err: `cannot fetch jobs: ${err.message}` } });
          }
        }),
        this.pollInterval * 1000
      );
    }

    stopPolling() {
      debug('stopping polling');
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    async fetch(count = this.batchSize, lockTime = this.jobLockTime) {
      debug('fetching jobs');
      const jobs = await dbAdapter.fetchJobs(count, lockTime);
      debug(`${jobs.length} jobs found`);
      return jobs;
    }

    async fetchAndProcess(count = this.batchSize, lockTime = this.jobLockTime) {
      const jobs = await this.fetch(count, lockTime);
      // Wait for all handlers
      await Promise.allSettled(jobs.map(this._process));
      return jobs;
    }

    /**
     * Set the main handler for the jobs with the given name
     *
     * Any name can (and should) have only one main handler. If job handler
     * hasn't been set, the job process failed.
     *
     * @param {string} name
     * @param {Function} handler
     */
    on(name, handler) {
      if (this._handlers.has(name)) {
        // Only one handler per name is allowed
        debugError(`attempt to add a second handler for '${name}' jobs`);
        throw new Error(`attempt to add a second handler for '${name}' jobs`);
      }

      this._handlers.set(name, handler);

      // Return unsubscribe function
      return () => this._handlers.delete(name);
    }

    /**
     * Set the complete handler for the jobs with the given name
     *
     * The complete handlers called in parallel after the successiful run of the
     * main handler and before the job deletion.
     *
     * @param {string|ANY_JOB} name
     * @param {Function} handler
     */
    onComplete(name, handler) {
      return this._completeEvents.on(name, handler);
    }

    /**
     * Set the failure handler for the jobs with the given name
     *
     * The failure handlers called in parallel after the main handler failure
     * (or if the main handler is not defined) and after the job unlockAt
     * prolongation.
     *
     * @param {string|ANY_JOB} name
     * @param {Function} handler
     */
    onFailure(name, handler) {
      return this._failureEvents.on(name, handler);
    }

    _process = async (job) => {
      const handler = this._handlers.get(job.name);

      try {
        if (handler) {
          const result = await handler(job);
          await this._completeEvents.emit(job.name, job, result);
          await job.delete();
        } else {
          throw new Error(`handler is not registered for '${job.name}'`);
        }
      } catch (err) {
        debugError(`error processing job '${job.name}'`, err, job);

        if (sentryIsEnabled) {
          Raven.captureException(
            err,
            { extra: { err: `error processing job '${job.name}': ${err?.message}` } }
          );
        }

        await job.setUnlockAt(this.jobLockTime * (job.attempts ** 1.5));
        await this._failureEvents.emit(job.name, job, err);
      }
    };
  }
}

/**
 * unlockAt can be:
 * - Date object (will be interpreted as a DB server time)
 * - number (of seconds from now)
 */
function _checkUnlockAtType(unlockAt = null) {
  if (!(unlockAt instanceof Date) && !Number.isFinite(unlockAt)) {
    throw new Error('Invalid type of unlockAt parameter');
  }
}

class PicoEvents {
  _handlers = new Map();
  catchAll;

  constructor(catchAll = null) {
    this.catchAll = catchAll;
  }

  on(name, handler) {
    {
      const hs = this._handlers.get(name);
      hs ? hs.push(handler) : this._handlers.set(name, [handler]);
    }

    // Return unsubscribe function
    return () => {
      const hs = this._handlers.get(name);
      hs && hs.splice(hs.indexOf(handler) >>> 0, 1);
    };
  }

  /**
   * All handlers called asynchronously and in parallel. Method waits for all
   * handlers to complete.
   */
  emit(name, ...args) {
    const handlers = [
      ...(this._handlers.get(name) || []),
      ...((this.catchAll && this._handlers.get(this.catchAll)) || []),
    ];
    return Promise.allSettled(handlers.map((h) => h(...args)));
  }
}
