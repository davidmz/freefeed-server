import Raven from 'raven';
import config from 'config';

import { JobManager } from '../models';
import { ANY_JOB } from '../models/job';

import { initHandlers as initUserGoneHandlers } from './user-gone';


export function initJobProcessing() {
  const jobManager = new JobManager(config.jobManager);
  initUserGoneHandlers(jobManager);

  jobManager.onFailure(ANY_JOB, (job, error) => {
    if ('sentryDsn' in config) {
      Raven.captureException(
        error,
        { extra: { err: `error processing job '${job.name}': ${error?.message}` } }
      );
    }
  });

  if (process.env.NODE_ENV !== 'test') {
    jobManager.startPolling();
  }

  return jobManager;
}
