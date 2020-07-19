/* eslint-env node, mocha */
/* global $pg_database */
import unexpected from 'unexpected';
import unexpectedDate from 'unexpected-date';
import unexpectedSinon from 'unexpected-sinon';
import sinon from 'sinon';
import { sortBy } from 'lodash';

import cleanDB from '../../dbCleaner';
import { Job, dbAdapter, JobManager } from '../../../app/models';
import { ANY_JOB } from '../../../app/models/job';


const expect = unexpected.clone();
expect
  .use(unexpectedDate)
  .use(unexpectedSinon);

describe('Jobs', () => {
  describe('Single job operations', () => {
    before(() => cleanDB($pg_database));

    it(`should create a job`, async () => {
      const [job, now] = await Promise.all([Job.create('job'), dbAdapter.now()]);
      expect(job, 'to satisfy', {
        name:      'job',
        payload:   {},
        createdAt: expect.it('to be close to', now),
        unlockAt:  expect.it('to be close to', now),
      });
    });

    it(`should delete a job`, async () => {
      const job = await Job.create('job');

      expect(await Job.getById(job.id), 'not to be null');
      await job.delete();
      expect(await Job.getById(job.id), 'to be null');
    });

    it(`should create a job with scalar payload`, async () => {
      const job = await Job.create('job', 42);
      expect(job, 'to satisfy', { name: 'job', payload: 42 });
    });

    it(`should create a job with object payload`, async () => {
      const job = await Job.create('job', { foo: 42 });
      expect(job, 'to satisfy', { name: 'job', payload: { foo: 42 } });
    });

    it(`should create a deferred job with integer offset`, async () => {
      const [job, now] = await Promise.all([
        Job.create('job', {}, { unlockAt: 100 }),
        dbAdapter.now(),
      ]);
      expect(job, 'to satisfy', {
        name:      'job',
        payload:   {},
        createdAt: expect.it('to be close to', now),
        unlockAt:  expect.it('to be close to', new Date(now.getTime() + (100 * 1000))),
      });
    });

    it(`should create a deferred job with float offset`, async () => {
      const [job, now] = await Promise.all([
        Job.create('job', {}, { unlockAt: 100.45 }),
        dbAdapter.now(),
      ]);
      expect(job, 'to satisfy', {
        name:      'job',
        payload:   {},
        createdAt: expect.it('to be close to', now),
        unlockAt:  expect.it('to be close to', new Date(now.getTime() + (100.45 * 1000))),
      });
    });

    it(`should create a deferred job with exact Date`, async () => {
      const unlockAt = new Date(Date.now() + 12345000);
      const [job, now] = await Promise.all([
        Job.create('job', {}, { unlockAt }),
        dbAdapter.now(),
      ]);
      expect(job, 'to satisfy', {
        name:      'job',
        payload:   {},
        createdAt: expect.it('to be close to', now),
        unlockAt:  expect.it('to be close to', unlockAt),
      });
    });

    it(`should update unlock time a job after creation`, async () => {
      const [job, now] = await Promise.all([
        Job.create('job'),
        dbAdapter.now(),
      ]);
      expect(job, 'to satisfy', { unlockAt: expect.it('to be close to', now) });
      await job.setUnlockAt(100);
      expect(job, 'to satisfy', { unlockAt: expect.it('to be close to', new Date(now.getTime() + (100 * 1000))) });
    });
  });

  describe('Job manager', () => {
    beforeEach(() => cleanDB($pg_database));

    let jm;
    beforeEach(() => (jm = new JobManager()));

    it('should not fetch jobs from empty queue', async () => {
      const jobs = await jm.fetch();
      expect(jobs, 'to be empty');
    });

    it('should fetch placed jobs', async () => {
      const [job1, now] = await Promise.all([
        Job.create('job'),
        dbAdapter.now(),
      ]);
      const job2 = await Job.create('job');
      const jobs = await jm.fetch();

      expect(sortBy(jobs, 'createdAt'), 'to satisfy', [
        {
          id:       job1.id,
          unlockAt: expect.it('to be close to', new Date(now.getTime() + (jm.jobLockTime * 1000))),
        },
        {
          id:       job2.id,
          unlockAt: expect.it('to be close to', new Date(now.getTime() + (jm.jobLockTime * 1000))),
        }
      ]);
    });

    it('should fetch placed job only once', async () => {
      const job = await Job.create('job');

      {
        const jobs = await jm.fetch();
        expect(jobs, 'to satisfy', [{ id: job.id }]);
      }

      {
        const jobs = await jm.fetch();
        expect(jobs, 'to be empty');
      }
    });

    it('should fetch placed job again after the timeout', async () => {
      const job = await Job.create('job');

      {
        const jobs = await jm.fetch();
        expect(jobs, 'to satisfy', [{ id: job.id }]);
      }

      // Manually reset the job lock time to 'now'
      await job.setUnlockAt(0);

      {
        const jobs = await jm.fetch();
        expect(jobs, 'to satisfy', [{ id: job.id }]);
      }
    });

    describe('Job processing', () => {
      it(`should not allow to assign two job handlers`, () => {
        jm.on('job', () => null);
        expect(() => jm.on('job', () => null), 'to throw');
      });

      it(`should fetch and process jobs`, async () => {
        const spy1 = sinon.spy();
        const spy2 = sinon.spy();
        jm.on('job1', spy1);
        jm.on('job2', spy2);

        const job1 = await Job.create('job1');
        const job2 = await Job.create('job2');

        await jm.fetchAndProcess();

        expect(spy1, 'to have a call satisfying', [{ id: job1.id }]);
        expect(spy2, 'to have a call satisfying', [{ id: job2.id }]);

        // Jobs should be deleted
        expect(await Job.getById(job1.id), 'to be null');
        expect(await Job.getById(job2.id), 'to be null');
      });

      it(`should re-lock job if it have no handler`, async () => {
        const [job, now] = await Promise.all([
          Job.create('job'),
          dbAdapter.now(),
        ]);

        const [job1] = await jm.fetchAndProcess();

        expect(job1, 'to satisfy', {
          id:       job.id,
          attempts: 1,
          unlockAt: expect.it('to be close to', new Date(now.getTime() + (jm.jobLockTime * 1000))),
        });
      });

      describe(`Lifecycle handlers`, () => {
        let completeHandler;
        let failureHandler;

        beforeEach(() => {
          completeHandler = sinon.spy();
          failureHandler = sinon.spy();
          jm.onComplete('job', completeHandler);
          jm.onFailure('job', failureHandler);
        });

        it(`should call onComplete handler when job is completed`, async () => {
          const mainHandler = sinon.spy(() => 42);
          jm.on('job', mainHandler);

          const job = await Job.create('job');
          await jm.fetchAndProcess();

          expect(mainHandler, 'to have a call satisfying', [{ id: job.id }]);
          expect(completeHandler, 'to have a call satisfying', [{ id: job.id }, 42]);
          expect(failureHandler, 'was not called');
          expect([mainHandler, completeHandler], 'given call order');
        });

        it(`should call onFailure handler when job is failed`, async () => {
          const mainHandler = sinon.spy(() => Promise.reject('Failure!'));
          jm.on('job', mainHandler);

          const job = await Job.create('job');
          await jm.fetchAndProcess();

          expect(mainHandler, 'to have a call satisfying', [{ id: job.id }]);
          expect(completeHandler, 'was not called');
          expect(failureHandler, 'to have a call satisfying', [{ id: job.id }, 'Failure!']);
          expect([mainHandler, failureHandler], 'given call order');
        });


        it(`should call onComplete catch-all handler when job is completed`, async () => {
          const mainHandler = sinon.spy(() => 42);
          const catchHandler = sinon.spy();
          jm.on('job', mainHandler);
          jm.onComplete(ANY_JOB, catchHandler);

          const job = await Job.create('job');
          await jm.fetchAndProcess();

          expect(mainHandler, 'to have a call satisfying', [{ id: job.id }]);
          expect(catchHandler, 'to have a call satisfying', [{ id: job.id }, 42]);
          expect([mainHandler, catchHandler], 'given call order');
        });
      });
    });
  });
});
