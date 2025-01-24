import { EventEmitter } from "events";
import { parseExpression } from "cron-parser";
import debug from "debug";
import { Job, JobResult, SchedulerConfig } from "./types";
import { PluginContext } from "../plugins/types";
import { CacheService } from "../cache.service";
import { Timer } from "../../types/message.types";

const log = debug("arok:scheduler");

export const SCHEDULER_EVENTS = {
  HEARTBEAT: "scheduler:heartbeat",
  JOB_COMPLETE: "scheduler:job:complete",
  JOB_ERROR: "scheduler:job:error"
} as const;

export class SchedulerService {
  private jobs: Job[] = [];
  public readonly config: SchedulerConfig;
  private isInitialized: boolean = false;
  private readonly CACHE_PREFIX = "scheduler:job:";
  private eventEmitter: EventEmitter;
  private heartbeatInterval?: Timer;
  private cacheService: CacheService;

  constructor(config: SchedulerConfig, cacheService: CacheService) {
    this.config = {
      timeZone: "UTC",
      mode: "single-node",
      heartbeatInterval: 60000, // 1 minute default
      cacheTTL: 24 * 60 * 60 * 1000, // 24 hours default
      ...config
    };

    this.cacheService = cacheService;

    this.eventEmitter = new EventEmitter();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Subscribe to heartbeat events
    this.eventEmitter.on(SCHEDULER_EVENTS.HEARTBEAT, async () => {
      await this.processJobs();
    });

    // Set up event listeners for job results
    this.eventEmitter.on(
      SCHEDULER_EVENTS.JOB_COMPLETE,
      async (result: JobResult) => {
        await this.handleJobComplete(result);
      }
    );

    this.eventEmitter.on(
      SCHEDULER_EVENTS.JOB_ERROR,
      async (error: JobResult) => {
        await this.handleJobError(error);
      }
    );

    // Start heartbeat if in single-node mode
    if (this.config.mode === "single-node") {
      await this.startHeartbeat();
    }

    this.isInitialized = true;
    log(`Scheduler initialized in ${this.config.mode} mode`);
  }

  private async startHeartbeat(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.triggerHeartbeat().catch((error) => {
        console.error("Error in heartbeat interval:", error);
      });
    }, this.config.heartbeatInterval);

    log(`Started heartbeat interval (${this.config.heartbeatInterval}ms)`);

    // Trigger initial heartbeat
    await this.triggerHeartbeat();
  }

  private async stopHeartbeat(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
      log("Stopped heartbeat interval");
    }
  }

  async triggerHeartbeat(): Promise<void> {
    log("Triggering heartbeat");
    this.eventEmitter.emit(SCHEDULER_EVENTS.HEARTBEAT);
  }

  async registerJob(job: Job): Promise<void> {
    this.jobs.push(job);
    log(`Registered job: ${job.id}`);

    // Store job registration in cache
    await this.cacheService.set(
      `${this.CACHE_PREFIX}${job.id}:config`,
      {
        id: job.id,
        schedule: job.schedule,
        metadata: job.metadata,
        registeredAt: new Date().toISOString()
      },
      {
        type: "job_config",
        jobId: job.id,
        ttl: this.config.cacheTTL
      }
    );
  }

  private async handleJobComplete(result: JobResult): Promise<void> {
    const { jobId } = result;
    log(`Job ${jobId} completed`);

    await Promise.all([
      this.cacheService.set(
        `${this.CACHE_PREFIX}${jobId}:lastRun`,
        new Date().toISOString(),
        {
          type: "job_execution",
          jobId,
          ttl: this.config.cacheTTL
        }
      ),
      this.cacheService.set(`${this.CACHE_PREFIX}${jobId}:lastResult`, result, {
        type: "job_result",
        jobId,
        ttl: this.config.cacheTTL
      })
    ]);
  }

  private async handleJobError(error: JobResult): Promise<void> {
    const { jobId } = error;

    await this.cacheService.set(
      `${this.CACHE_PREFIX}${jobId}:lastError`,
      error,
      {
        type: "job_error",
        jobId,
        ttl: this.config.cacheTTL
      }
    );
  }

  private async shouldJobRun(job: Job, currentTime: Date): Promise<boolean> {
    try {
      // Get last run time from cache
      const lastRunKey = `${this.CACHE_PREFIX}${job.id}:lastRun`;
      const lastRun = await this.cacheService.get(lastRunKey);

      log(`Checking schedule for job ${job.id}`);
      log(`Last run: ${lastRun}`);
      if (!lastRun) {
        return true; // First run
      }

      const interval = parseExpression(job.schedule, {
        currentDate: new Date(lastRun),
        tz: this.config.timeZone
      });

      const nextRun = interval.next().toDate();
      // log(
      //   "Should run - ",
      //   job.schedule,
      //   "Last run: ",
      //   lastRun,
      //   "Next run: ",
      //   nextRun,
      //   "Current time: ",
      //   currentTime,
      //   "run now: ",
      //   nextRun <= currentTime
      // );
      return nextRun <= currentTime;
    } catch (error) {
      console.error(`Error checking job schedule for ${job.id}:`, error);
      return false;
    }
  }

  private async executeJob(job: Job): Promise<JobResult> {
    try {
      log(`Executing job: ${job.id}`);
      const result = await job.handler();

      const jobResult: JobResult = {
        jobId: job.id,
        status: "success",
        timestamp: new Date().toISOString(),
        result
      };

      this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_COMPLETE, jobResult);
      return jobResult;
    } catch (error) {
      const jobResult: JobResult = {
        jobId: job.id,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      };

      this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_ERROR, jobResult);
      return jobResult;
    }
  }

  async processJobs(): Promise<{ timestamp: string; results: JobResult[] }> {
    const currentTime = new Date();
    const jobsToRun = await Promise.all(
      this.jobs.map(async (job) => ({
        job,
        shouldRun: await this.shouldJobRun(job, currentTime)
      }))
    ).then((results) =>
      results.filter(({ shouldRun }) => shouldRun).map(({ job }) => job)
    );

    log(`Processing ${jobsToRun.length} jobs`);
    const results = await Promise.all(
      jobsToRun.map((job) => this.executeJob(job))
    );
    log(results.length, "jobs completed");

    return {
      timestamp: currentTime.toISOString(),
      results
    };
  }

  async shutdown(): Promise<void> {
    await this.stopHeartbeat();
    this.eventEmitter.removeAllListeners();
    this.isInitialized = false;
    log("Scheduler shut down");
  }

  async getJobStatus(jobId: string): Promise<{
    lastRun?: string;
    lastResult?: JobResult;
    lastError?: JobResult;
    config?: Job;
  }> {
    const [lastRun, lastResult, lastError, config] = await Promise.all([
      this.cacheService.get(`${this.CACHE_PREFIX}${jobId}:lastRun`),
      this.cacheService.get(`${this.CACHE_PREFIX}${jobId}:lastResult`),
      this.cacheService.get(`${this.CACHE_PREFIX}${jobId}:lastError`),
      this.cacheService.get(`${this.CACHE_PREFIX}${jobId}:config`)
    ]);

    return {
      lastRun,
      lastResult,
      lastError,
      config
    };
  }
}
