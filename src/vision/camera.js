import { WorldView } from 'prismarine-viewer/viewer/lib/worldView.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { renderCompatibility } from './render_compat.js';
import { buildViewer, waitMeshes, renderStill, disposeViewer } from './render-core.js';
import { worldFeed, waitForColumn, eyePose, LIMITATIONS } from './feed.js';

export class Camera extends EventEmitter {
    constructor(bot, fp, { viewDistance = 4, width = 800, height = 512, timeoutMs = 90000 } = {}) {
        super();
        this.bot = bot;
        this.fp = fp;
        this.viewDistance = viewDistance;
        this.width = width;
        this.height = height;
        this.timeoutMs = timeoutMs;
        this.compat = renderCompatibility(bot.version);
        this.scene = buildViewer(width, height);
        this.viewer = this.scene.viewer;
        this.renderer = this.scene.renderer;
        this.canvas = this.scene.canvas;
        this.closed = false;
        this.queue = Promise.resolve();
        this.ready = this.scene.workersStopped
            .then(() => {
                if (this.closed) throw new Error('Camera is closed');
                return this._init();
            })
            .then(() => {
                this.emit('ready');
            });
        this.ready.catch(() => {});
        this.onEnd = () => {
            void this.close();
        };
        bot.once('end', this.onEnd);
        this.animationTimer = setInterval(() => {
            if (!this.closed) this.viewer.update();
        }, 1000);
        this.animationTimer.unref();
    }

    get workerError() {
        return this.scene.workerError;
    }

    get metadata() {
        return {
            sourceVersion: this.compat.sourceVersion,
            renderVersion: this.compat.renderVersion,
            unsupportedBlocks: [...this.compat.unsupportedBlocks],
            limitations: LIMITATIONS,
        };
    }

    _check() {
        if (this.closed) throw new Error('Camera is closed');
        if (this.scene.workerError) throw this.scene.workerError;
    }

    async _waitForRender() {
        const deadline = Date.now() + this.timeoutMs;
        await waitForColumn(this.worldView, this.bot, deadline, () => this._check());
        await waitMeshes(this.scene, deadline, () => this._check());
    }

    async _init() {
        this.viewer.setVersion(this.compat.renderVersion);
        const { emitter } = worldFeed(this.bot, this.compat, () => {});
        const worldView = new WorldView(this.bot.world, this.viewDistance, this.bot.entity.position, emitter);
        this.worldView = worldView;
        this.viewer.listen(emitter);
        worldView.listenToBot(this.bot);
        await worldView.init(this.bot.entity.position);
        await this._waitForRender();
    }

    capture() {
        const next = this.queue.then(() => this._capture());
        this.queue = next.catch(() => {});
        return next;
    }

    async _capture() {
        await this.ready;
        if (this.closed) throw new Error('Camera is closed');
        await this.worldView.updatePosition(this.bot.entity.position);
        await this._waitForRender();
        const buffer = renderStill(this.scene, eyePose(this.bot.entity));
        await fs.mkdir(this.fp, { recursive: true });
        const filename = `screenshot_${Date.now()}_${randomUUID()}`;
        await fs.writeFile(path.join(this.fp, `${filename}.jpg`), buffer);
        return filename;
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.animationTimer);
        this.bot.removeListener('end', this.onEnd);
        if (this.worldView?.listeners[this.bot.username]) this.worldView.removeListenersFromBot(this.bot);
        await disposeViewer(this.scene);
    }
}
