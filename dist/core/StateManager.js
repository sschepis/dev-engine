// =============================================================================
// OpenClaw DevEngine - State Manager (Checkpoint/Resume)
// =============================================================================
import * as crypto from 'crypto';
/**
 * Manages execution state persistence for checkpoint/resume functionality.
 * Stores state as JSON files in a configurable directory.
 */
export class StateManager {
    fs;
    stateDir;
    constructor(fs, options = {}) {
        this.fs = fs;
        this.stateDir = options.stateDir ?? '.openclaw/state';
    }
    /**
     * Generate a unique plan ID from goal and timestamp
     */
    static generatePlanId(goal) {
        const hash = crypto.createHash('sha256').update(goal).digest('hex').slice(0, 8);
        const timestamp = Date.now().toString(36);
        return `plan-${hash}-${timestamp}`;
    }
    /**
     * Get the file path for a given plan ID
     */
    getStatePath(planId) {
        return `${this.stateDir}/${planId}.json`;
    }
    /**
     * Save execution state to disk
     */
    async save(state) {
        await this.ensureStateDir();
        const serialized = JSON.stringify({
            ...state,
            lastCheckpoint: new Date().toISOString(),
            tasks: state.tasks.map(t => ({
                ...t,
                startedAt: t.startedAt?.toISOString(),
                completedAt: t.completedAt?.toISOString()
            }))
        }, null, 2);
        await this.fs.writeFile(this.getStatePath(state.planId), serialized);
    }
    /**
     * Load execution state from disk
     */
    async load(planId) {
        const path = this.getStatePath(planId);
        if (!(await this.exists(planId))) {
            return null;
        }
        try {
            const content = await this.fs.readFile(path);
            const parsed = JSON.parse(content);
            // Deserialize dates
            return {
                ...parsed,
                startedAt: new Date(parsed.startedAt),
                lastCheckpoint: new Date(parsed.lastCheckpoint),
                tasks: parsed.tasks.map((t) => ({
                    ...t,
                    startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
                    completedAt: t.completedAt ? new Date(t.completedAt) : undefined
                }))
            };
        }
        catch (error) {
            return null;
        }
    }
    /**
     * List all saved plan IDs
     */
    async list() {
        await this.ensureStateDir();
        try {
            const files = await this.fs.listFiles(this.stateDir, { recursive: false });
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''));
        }
        catch {
            return [];
        }
    }
    /**
     * Delete a saved state
     */
    async delete(planId) {
        const path = this.getStatePath(planId);
        try {
            await this.fs.delete(path);
        }
        catch {
            // Ignore if doesn't exist
        }
    }
    /**
     * Check if a state file exists
     */
    async exists(planId) {
        return this.fs.exists(this.getStatePath(planId));
    }
    /**
     * Find the most recent checkpoint for a goal
     */
    async findLatestForGoal(goal) {
        const planIds = await this.list();
        let latestState = null;
        let latestTime = 0;
        for (const planId of planIds) {
            const state = await this.load(planId);
            if (state && state.goal === goal) {
                const checkpointTime = state.lastCheckpoint.getTime();
                if (checkpointTime > latestTime) {
                    latestTime = checkpointTime;
                    latestState = state;
                }
            }
        }
        return latestState;
    }
    /**
     * Clean up old checkpoints, keeping only the N most recent
     */
    async cleanup(keepCount = 10) {
        const planIds = await this.list();
        if (planIds.length <= keepCount) {
            return 0;
        }
        // Load all states to get their timestamps
        const states = [];
        for (const planId of planIds) {
            const state = await this.load(planId);
            if (state) {
                states.push({ planId, timestamp: state.lastCheckpoint.getTime() });
            }
        }
        // Sort by timestamp (newest first)
        states.sort((a, b) => b.timestamp - a.timestamp);
        // Delete oldest beyond keepCount
        let deleted = 0;
        for (let i = keepCount; i < states.length; i++) {
            await this.delete(states[i].planId);
            deleted++;
        }
        return deleted;
    }
    /**
     * Create initial execution state from a goal
     */
    static createInitialState(goal) {
        return {
            planId: StateManager.generatePlanId(goal),
            goal,
            phase: 'planning',
            tasks: [],
            architectureReasoning: '',
            startedAt: new Date(),
            lastCheckpoint: new Date()
        };
    }
    /**
     * Update a specific task in the state
     */
    static updateTaskState(state, taskId, updates) {
        return {
            ...state,
            tasks: state.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
            lastCheckpoint: new Date()
        };
    }
    /**
     * Get tasks that can be resumed (were in progress or pending)
     */
    static getResumableTasks(state) {
        return state.tasks.filter(t => t.status === 'PENDING' || t.status === 'RUNNING');
    }
    /**
     * Check if state represents a completed execution
     */
    static isComplete(state) {
        return state.phase === 'completed' ||
            state.tasks.every(t => t.status === 'COMPLETED');
    }
    /**
     * Check if state represents a failed execution that cannot be resumed
     */
    static isFatallyFailed(state) {
        return state.phase === 'failed' &&
            state.tasks.some(t => t.status === 'FAILED' && t.attempts >= 3);
    }
    async ensureStateDir() {
        const exists = await this.fs.exists(this.stateDir);
        if (!exists) {
            await this.fs.mkdir(this.stateDir, { recursive: true });
        }
    }
}
