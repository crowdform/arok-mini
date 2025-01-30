import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import debug from "debug";

const log = debug("arok:plugin:activity");

interface Activity {
  id: string;
  title: string;
  description: string;
  scheduledTime?: Date;
  recurrence?: string;
  outcome?: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  metadata?: Record<string, any>;
}

interface DailyGoal {
  id: string;
  description: string;
  date: string;
  completed: boolean;
  progress: number;
  activities: string[];
  priority?: "low" | "medium" | "high";
  metrics?: {
    target?: number;
    current?: number;
    unit?: string;
  };
}

export class ActivityPlugin implements ExtendedPlugin {
  private context!: PluginContext;
  private readonly ACTIVITIES_CACHE_KEY = "activities:list";
  private readonly GOALS_CACHE_KEY = "activities:goals";
  private activities: Map<string, Activity> = new Map();
  private dailyGoals: Map<string, DailyGoal> = new Map();

  metadata: PluginMetadata = {
    name: "activity_management",
    description: "Manages agent activities, goals, and task scheduling",
    version: "1.0.0",
    callable: true,
    getSystemPrompt: () => `
    <activity_management>
# Activity Management System

Available actions for managing activities and goals:

1. ADD_ACTIVITY: Schedule new activities with optional recurrence
2. UPDATE_ACTIVITY: Modify existing activities
3. REMOVE_ACTIVITY: Remove activities from the agenda
4. SET_DAILY_GOALS: Define and track daily objectives
5. CHECK_GOALS: Check your current goals and activities status
6. EXECUTE_ACTIVITY: Manually execute a specific task or activity

Current activities and goals:
${this.getActivityPrompt()}

Consider:
- Use ADD_ACTIVITY for scheduling specific tasks
- Use SET_DAILY_GOALS for higher-level objectives
- Check existing activities before adding new ones
- Prioritize activities based on goals
- Use CHECK_GOALS to monitor progress
- Once an activity is ADDED do not execute it in the same session, wait for the user to ask for manual execution, or let the scheduler handle it
- Use EXECUTE_ACTIVITY to manually execute a specific task or activity - this will then output the result of the execution directly so no further tools should be needed.

  </activity_management>
`,
    actions: {
      CHECK_GOALS: {
        scope: ["*"],
        description: "Check current goals and activities status",
        schema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Optional date to check (YYYY-MM-DD). Defaults to today"
            },
            includeCompleted: {
              type: "boolean",
              description: "Whether to include completed goals and activities"
            }
          },
          required: ["date"]
        },
        examples: [
          {
            input: { date: "2025-01-24", includeCompleted: false },
            output: {
              goals: [
                {
                  description: "Increase market engagement",
                  progress: 75,
                  priority: "high"
                }
              ],
              activities: [
                {
                  title: "Market Analysis",
                  completed: false,
                  priority: "high"
                }
              ]
            }
          }
        ]
      },
      EXECUTE_ACTIVITY: {
        scope: ["*"],
        description: "Manually execute a specific task or activity",
        schema: {
          type: "object",
          properties: {
            activityId: {
              type: "string",
              description: "ID of the activity to execute"
            }
          },
          required: ["activityId"]
        },
        examples: [
          {
            input: {
              activityId: "abc-123"
            },
            output: {
              status: "completed",
              outcome: "Task executed successfully",
              details: {
                executionTime: "2025-01-24T15:00:00Z",
                duration: "5m"
              }
            }
          }
        ]
      },
      ADD_ACTIVITY: {
        scope: ["*"],
        description: "Add a new activity to the agenda",
        schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Activity title" },
            description: {
              type: "string",
              description: "Activity description"
            },
            scheduledTime: {
              type: "string",
              description: "ISO datetime or null"
            },
            recurrence: {
              type: "string",
              description: "Cron expression or null"
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Activity priority level"
            },
            tags: {
              type: "array",
              items: {
                type: "string",
                description: "Tags for categorizing the activity"
              },
              description: "Tags for categorizing the activity"
            }
          },
          required: ["title", "description"]
        },
        examples: [
          {
            input: {
              title: "Market Analysis",
              description: "Analyze current market trends",
              scheduledTime: "2025-01-24T15:00:00Z",
              recurrence: "0 15 * * 1-5",
              priority: "high",
              tags: ["market", "analysis"]
            },
            output: { activityId: "abc-123", status: "scheduled" }
          }
        ]
      },
      UPDATE_ACTIVITY: {
        description: "Update an existing activity",
        scope: ["*"],
        schema: {
          type: "object",
          properties: {
            activityId: { type: "string", description: "Activity ID" },
            updates: {
              type: "object",
              properties: {
                title: { type: "string", description: "Activity title" },
                description: {
                  type: "string",
                  description: "Activity description"
                },
                scheduledTime: {
                  type: "string",
                  description: "ISO datetime or null"
                },
                recurrence: {
                  type: "string",
                  description: "Cron expression or null"
                },
                completed: {
                  type: "boolean",
                  description: "Activity completion status"
                },
                priority: { type: "string", enum: ["low", "medium", "high"] },
                tags: { type: "array", items: { type: "string" } }
              }
            }
          },
          required: ["activityId", "updates"]
        },
        examples: [
          {
            input: {
              activityId: "abc-123",
              updates: {
                completed: true,
                priority: "high"
              }
            },
            output: { status: "updated" }
          }
        ]
      },
      REMOVE_ACTIVITY: {
        scope: ["*"],
        description: "Remove an activity from the agenda",
        schema: {
          type: "object",
          properties: {
            activityId: { type: "string", description: "Activity ID" }
          },
          required: ["activityId"]
        },
        examples: [
          {
            input: { activityId: "abc-123" },
            output: { status: "removed" }
          }
        ]
      },
      SET_DAILY_GOALS: {
        scope: ["*"],
        description: "Set or update daily goals",
        schema: {
          type: "object",
          properties: {
            goals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: {
                    type: "string",
                    description: "Goal description"
                  },
                  activities: { type: "array", items: { type: "string" } },
                  priority: { type: "string", enum: ["low", "medium", "high"] },
                  metrics: {
                    type: "object",
                    properties: {
                      target: { type: "number" },
                      unit: { type: "string" }
                    }
                  }
                }
              }
            },
            date: { type: "string", description: "Date for the goals" }
          },
          required: ["goals", "date"]
        },
        examples: [
          {
            input: {
              goals: [
                {
                  description: "Increase market engagement",
                  activities: ["abc-123", "def-456"],
                  priority: "high",
                  metrics: {
                    target: 1000,
                    unit: "interactions"
                  }
                }
              ],
              date: "2025-01-24"
            },
            output: { status: "goals_set" }
          }
        ]
      }
    }
  };

  parseDate = (dateString: string) => {
    // Handle YYYY-MM-DD format directly
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }

    // If it's another format, try parsing it
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      // If parsing fails, return today's date
      return new Date().toISOString().split("T")[0];
    }
    return date.toISOString().split("T")[0];
  };

  actions = {
    CHECK_GOALS: {
      execute: async (data: { date?: string; includeCompleted?: boolean }) => {
        log("Checking goals with data:", data);
        const targetDate = data.date
          ? this.parseDate(data.date)
          : new Date().toISOString().split("T")[0];
        const includeCompleted = data.includeCompleted ?? false;

        // Get goals for the target date
        const relevantGoals = Array.from(this.dailyGoals.values())
          .filter((goal) => {
            const dateMatch = goal.date === targetDate;
            return includeCompleted ? dateMatch : dateMatch && !goal.completed;
          })
          .map((goal) => ({
            id: goal.id,
            description: goal.description,
            progress: goal.progress,
            priority: goal.priority,
            metrics: goal.metrics,
            completed: goal.completed
          }));

        // Get associated activities
        const relevantActivities = Array.from(this.activities.values())
          .filter((activity) => {
            if (!activity.scheduledTime) return false;
            const activityDate = new Date(activity.scheduledTime)
              .toISOString()
              .split("T")[0];
            return (
              (includeCompleted ? true : !activity.completed) &&
              activityDate === targetDate
            );
          })
          .map((activity) => ({
            id: activity.id,
            title: activity.title,
            description: activity.description,
            priority: activity.priority,
            tags: activity.tags,
            completed: activity.completed,
            scheduledTime: activity.scheduledTime
          }));

        return {
          date: targetDate,
          goals: relevantGoals,
          activities: relevantActivities,
          summary: {
            totalGoals: relevantGoals.length,
            completedGoals: relevantGoals.filter((g) => g.completed).length,
            totalActivities: relevantActivities.length,
            completedActivities: relevantActivities.filter((a) => a.completed)
              .length,
            averageProgress:
              relevantGoals.reduce((acc, goal) => acc + goal.progress, 0) /
              (relevantGoals.length || 1)
          }
        };
      }
    },
    EXECUTE_ACTIVITY: {
      execute: async (data: { activityId: string }) => {
        const activity = this.activities.get(data.activityId);
        if (!activity) {
          throw new Error("Activity not found");
        }

        try {
          const startTime = new Date();
          const executionResult = await this.executeActivity(activity);
          const endTime = new Date();
          const duration = endTime.getTime() - startTime.getTime();

          // Update activity with execution results
          await this.updateActivity({
            ...activity,
            // @ts-ignore
            lastExecuted: endTime,
            lastExecutionDuration: duration,
            lastExecutionResult: executionResult,
            metadata: {
              ...activity.metadata,
              lastExecution: {
                timestamp: endTime,
                result: executionResult
              }
            }
          });

          return {
            status: executionResult.status,
            outcome: executionResult.outcome,
            details: {
              executionTime: startTime.toISOString(),
              duration: `${Math.round(duration / 1000)}s`,
              activityId: activity.id
            }
          };
        } catch (error) {
          console.error(`Error executing activity ${activity.id}:`, error);
          // @ts-ignore
          throw new Error(`Failed to execute activity: ${error.message}`);
        }
      }
    },
    ADD_ACTIVITY: {
      execute: async (data: {
        title: string;
        description: string;
        scheduledTime?: string;
        recurrence?: string;
        priority?: "low" | "medium" | "high";
        tags?: string[];
      }) => {
        const activityId = crypto.randomUUID();
        const activity: Activity = {
          id: activityId,
          title: data.title,
          description: data.description,
          scheduledTime: data.scheduledTime
            ? new Date(data.scheduledTime)
            : undefined,
          recurrence: data.recurrence,
          priority: data.priority,
          tags: data.tags,
          completed: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.addActivity(activity);
        await this.notifyActivityChange(activity, "added");

        return { activityId, status: "scheduled" };
      }
    },
    UPDATE_ACTIVITY: {
      execute: async (data: {
        activityId: string;
        updates: Partial<Activity>;
      }) => {
        const activity = this.activities.get(data.activityId);
        if (!activity) {
          throw new Error("Activity not found");
        }

        const updatedActivity = {
          ...activity,
          ...data.updates,
          updatedAt: new Date()
        };

        await this.updateActivity(updatedActivity);
        await this.notifyActivityChange(updatedActivity, "updated");

        return { status: "updated" };
      }
    },
    REMOVE_ACTIVITY: {
      execute: async (data: { activityId: string }) => {
        const activity = this.activities.get(data.activityId);
        if (activity) {
          await this.removeActivity(data.activityId);
          await this.notifyActivityChange(activity, "removed");
        }
        return { status: "removed" };
      }
    },
    SET_DAILY_GOALS: {
      execute: async (data: {
        goals: Array<{
          description: string;
          activities: string[];
          priority?: "low" | "medium" | "high";
          metrics?: {
            target: number;
            unit: string;
          };
        }>;
        date: string;
      }) => {
        await this.setDailyGoals(data.date, data.goals);
        return { status: "goals_set" };
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    await this.loadState();
    await this.setupScheduledJobs();
    log("Activity plugin initialized");
  }

  private async setupScheduledJobs(): Promise<void> {
    await Promise.all([
      // Daily goal generation
      this.context.schedulerService.registerJob({
        id: "activities:generate-daily-goals",
        schedule: "0 0 * * *", // Midnight
        handler: async () => this.generateDailyGoals(),
        metadata: {
          plugin: this.metadata.name,
          description: "Generate daily goals"
        }
      }),

      // Activity check
      this.context.schedulerService.registerJob({
        id: "activities:check-scheduled",
        schedule: "*/15 * * * *", // Every 15 minutes
        handler: async () => this.checkScheduledActivities(),
        metadata: {
          plugin: this.metadata.name,
          description: "Check scheduled activities"
        }
      }),

      // Progress update
      this.context.schedulerService.registerJob({
        id: "activities:update-progress",
        schedule: "0 * * * *", // Every hour
        handler: async () => this.updateGoalProgress(),
        metadata: {
          plugin: this.metadata.name,
          description: "Update goal progress"
        }
      })
    ]);
  }

  private async loadState(): Promise<void> {
    const [savedActivities, savedGoals] = await Promise.all([
      this.context.cacheService.get(this.ACTIVITIES_CACHE_KEY),
      this.context.cacheService.get(this.GOALS_CACHE_KEY)
    ]);

    if (savedActivities) {
      this.activities = new Map(Object.entries(savedActivities));
    }

    if (savedGoals) {
      this.dailyGoals = new Map(Object.entries(savedGoals));
    }
  }

  private async saveState(): Promise<void> {
    await Promise.all([
      this.context.cacheService.set(
        this.ACTIVITIES_CACHE_KEY,
        Object.fromEntries(this.activities)
      ),
      this.context.cacheService.set(
        this.GOALS_CACHE_KEY,
        Object.fromEntries(this.dailyGoals)
      )
    ]);
  }

  private async updateGoalProgress(): Promise<void> {
    const today = new Date().toISOString().split("T")[0];
    const todayGoals = Array.from(this.dailyGoals.values()).filter(
      (g) => g.date === today
    );

    for (const goal of todayGoals) {
      const relatedActivities = goal.activities
        .map((id) => this.activities.get(id))
        .filter((a): a is Activity => a !== undefined);

      const completedCount = relatedActivities.filter(
        (a) => a.completed
      ).length;
      const progress =
        relatedActivities.length > 0
          ? (completedCount / relatedActivities.length) * 100
          : 0;

      this.dailyGoals.set(goal.id, {
        ...goal,
        progress,
        completed: progress === 100
      });
    }

    await this.saveState();
  }

  private async addActivity(activity: Activity): Promise<void> {
    this.activities.set(activity.id, activity);

    if (activity.scheduledTime || activity.recurrence) {
      await this.registerActivityJob(activity);
    }

    await this.saveState();
  }

  private async updateActivity(activity: Activity): Promise<void> {
    this.activities.set(activity.id, activity);
    await this.saveState();

    if (activity.scheduledTime || activity.recurrence) {
      await this.registerActivityJob(activity);
    }
  }

  private async removeActivity(activityId: string): Promise<void> {
    this.activities.delete(activityId);
    await this.saveState();
  }

  private async registerActivityJob(activity: Activity): Promise<void> {
    const jobId = `activity:${activity.id}`;

    await this.context.schedulerService.registerJob({
      id: jobId,
      schedule:
        activity.recurrence || this.getOneTimeSchedule(activity.scheduledTime!),
      handler: async () => {
        return this.executeActivity(activity);
      },
      metadata: {
        plugin: this.metadata.name,
        activityId: activity.id,
        type: "activity_execution"
      }
    });
  }

  private getOneTimeSchedule(date: Date): string {
    return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
  }

  private async executeActivity(activity: Activity): Promise<{
    status: "completed" | "failed" | "in_progress";
    outcome: string;
    error?: any;
  }> {
    const message: Message = {
      id: crypto.randomUUID(),
      content: `Execute scheduled activity: ${activity.title}\n${activity.description}, Priority: ${activity.priority}, Tags: ${activity.tags?.join(", ")}`,
      author: `system-activity-${activity.id}`,
      type: "request",
      source: "automated",
      createdAt: new Date().toISOString(),
      metadata: {
        type: "activity_execution",
        activityId: activity.id,
        priority: activity.priority,
        tags: activity.tags,
        requiresProcessing: true
      }
    };

    const content = await this.context.agentService.handleMessage(message, {
      postSystemPrompt: `
     # Activity Execution
    - Run as many tools as needed to complete the activity
    - Consider activity priority and tags when executing

    # Final Output should be in JSON format
    {
      "status": "completed" | "failed",
      "outcome": "Full outcome of the activity, including summary of steps and any issues encountered",
      "metrics": {
        "duration": "Execution duration in milliseconds",
        "resourcesUsed": ["List of resources or tools used"],
        "successRate": "Percentage of successful operations"
      }
    }
    `
    });

    let parsedContent: any;
    try {
      parsedContent =
        this.context.agentService.responseParser.parseJSON(content);
    } catch (error) {
      console.error("Error parsing activity response:", error);
      parsedContent = {
        status: "failed",
        outcome: "Failed to parse response",
        error
      };
    }

    if (!activity.recurrence) {
      await this.updateActivity({
        ...activity,
        outcome: parsedContent.content,
        completed: parsedContent.status === "completed",
        updatedAt: new Date(),
        metadata: {
          ...activity.metadata,
          response: parsedContent
        }
      });
    }

    return parsedContent;
  }

  private async notifyActivityChange(
    activity: Activity,
    action: "added" | "updated" | "removed"
  ): Promise<void> {
    const message: Message = {
      id: crypto.randomUUID(),
      content: `Activity ${action}: ${activity.title}`,
      author: "agent",
      type: "event",
      source: "automated",
      createdAt: new Date().toISOString(),
      metadata: {
        type: "activity_change",
        activity,
        action,
        timestamp: Date.now()
      }
    };

    await this.context.agentService.handleMessage(message);
  }

  private async setDailyGoals(
    date: string,
    goals: Array<{
      description: string;
      activities: string[];
      priority?: "low" | "medium" | "high";
      metrics?: {
        target: number;
        unit: string;
      };
    }>
  ): Promise<void> {
    const dailyGoals: DailyGoal[] = goals.map((goal) => ({
      id: crypto.randomUUID(),
      description: goal.description,
      date,
      completed: false,
      progress: 0,
      activities: goal.activities,
      priority: goal.priority,
      metrics: goal.metrics
    }));

    // Update goals map
    for (const goal of dailyGoals) {
      this.dailyGoals.set(goal.id, goal);
    }

    await this.saveState();
  }

  private async generateDailyGoals(): Promise<void> {
    const message: Message = {
      id: crypto.randomUUID(),
      content:
        "Generate 3 strategic goals for today based on current market conditions and ongoing activities.",
      author: "agent",
      type: "request",
      source: "automated",
      createdAt: new Date().toISOString(),
      metadata: {
        type: "goal_generation",
        requiresProcessing: true
      }
    };

    const response = await this.context.agentService.handleMessage(message);

    try {
      const goals = this.parseGoalsFromResponse(response.content);
      await this.setDailyGoals(new Date().toISOString().split("T")[0], goals);
    } catch (error) {
      console.error("Error parsing generated goals:", error);
    }
  }

  private parseGoalsFromResponse(
    content: string
  ): Array<{ description: string; activities: string[] }> {
    try {
      // First try to parse as JSON
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map((goal) => ({
          description: typeof goal === "string" ? goal : goal.description,
          activities: Array.isArray(goal.activities) ? goal.activities : []
        }));
      }
    } catch {
      // If JSON parsing fails, try to parse as plain text
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => ({
          description: line.replace(/^[-*]\s*/, "").trim(),
          activities: []
        }));
    }
    return [];
  }

  private async checkScheduledActivities(): Promise<void> {
    const now = new Date();
    const upcomingActivities = Array.from(this.activities.values()).filter(
      (activity) => {
        if (!activity.completed && activity.scheduledTime) {
          const scheduledTime = new Date(activity.scheduledTime);
          const timeDiff = scheduledTime.getTime() - now.getTime();
          // Check if scheduled within next 15 minutes
          return timeDiff >= 0 && timeDiff <= 15 * 60 * 1000;
        }
        return false;
      }
    );

    for (const activity of upcomingActivities) {
      await this.executeActivity(activity);
    }
  }

  private getActivityPrompt(): string {
    const activeActivities = Array.from(this.activities.values())
      .filter((a) => !a.completed)
      .map(
        (a) =>
          `- [${a.priority || "normal"}] (id:${a.id}) ${a.title}: ${a.description} (${
            a.scheduledTime
              ? new Date(a.scheduledTime).toLocaleString()
              : "No schedule"
          })${a.tags ? ` Tags: ${a.tags.join(", ")}` : ""}`
      );

    const todayGoals = Array.from(this.dailyGoals.values())
      .filter((g) => g.date === new Date().toISOString().split("T")[0])
      .map(
        (g) =>
          `- [${g.priority || "normal"}]  (id:${g.id}) ${g.description} (Progress: ${g.progress}%)${
            g.metrics ? ` Target: ${g.metrics.target} ${g.metrics.unit}` : ""
          }`
      );

    return `
Current Activities:
${activeActivities.length > 0 ? activeActivities.join("\n") : "No active activities"}

Today's Goals:
${todayGoals.length > 0 ? todayGoals.join("\n") : "No goals set for today"}`;
  }
}
