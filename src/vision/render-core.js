import { Viewer } from 'prismarine-viewer/viewer/lib/viewer.js';
import THREE from 'three';
global.THREE = THREE;
import { createCanvas } from 'node-canvas-webgl/lib/index.js';
import { Worker } from 'node:worker_threads';
import { Vec3 } from 'vec3';
global.Worker = class extends Worker {
    constructor(filename, options) {
        super(
            String(filename).endsWith('/prismarine-viewer/viewer/lib/worker.js')
                ? new URL('./world_worker.cjs', import.meta.url)
                : filename,
            options,
        );
    }
};

export function buildViewer(width, height) {
    const canvas = createCanvas(width, height);
    const hadWindow = typeof global.window !== 'undefined';
    if (!hadWindow)
        global.window = { requestAnimationFrame: cb => setTimeout(cb, 16), cancelAnimationFrame: clearTimeout };
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas });
    } finally {
        if (!hadWindow) delete global.window;
    }
    const viewer = new Viewer(renderer);
    const workersStopped = Promise.all(viewer.world.workers.splice(1).map(worker => worker.terminate()));
    const world = viewer.world;
    const addColumn = world.addColumn.bind(world);
    world.addColumn = (x, z, json) => {
        addColumn(x, z, json);
        const column = JSON.parse(json);
        const minY = column.minY ?? 0;
        const maxY = minY + (column.worldHeight ?? 256);
        for (let y = minY; y < maxY; y += 16) {
            if (y >= 0 && y < 256) continue;
            for (const [dx, dz] of [
                [0, 0],
                [-16, 0],
                [16, 0],
                [0, -16],
                [0, 16],
            ]) {
                world.setSectionDirty(new Vec3(x + dx, y, z + dz));
            }
        }
    };
    const removeColumn = world.removeColumn.bind(world);
    world.removeColumn = (x, z) => {
        removeColumn(x, z);
        for (const [key, mesh] of Object.entries(world.sectionMeshs)) {
            const [sx, , sz] = key.split(',').map(Number);
            if (sx === x && sz === z) {
                viewer.scene.remove(mesh);
                mesh.geometry.dispose();
                delete world.sectionMeshs[key];
            }
        }
    };
    const scene = { canvas, renderer, viewer, workersStopped, workerError: null };
    for (const worker of viewer.world.workers)
        worker.on('error', error => {
            scene.workerError = error;
        });
    return scene;
}

export async function waitMeshes(scene, deadline, check = () => {}) {
    const { viewer } = scene;
    while (!viewer.world.material.map || viewer.world.sectionsOutstanding.size) {
        check();
        if (scene.workerError) throw scene.workerError;
        if (Date.now() >= deadline) {
            if (viewer.world.material.map) {
                console.warn(
                    'Camera: proceeding with partial meshes, outstanding=' + viewer.world.sectionsOutstanding.size,
                );
                break;
            }
            throw new Error('Camera timed out waiting for textures');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (scene.workerError) throw scene.workerError;
}

export function renderStill(scene, { pos, pitch, yaw }) {
    const { viewer, renderer, canvas } = scene;
    viewer.update();
    viewer.camera.position.set(pos.x, pos.y, pos.z);
    viewer.camera.rotation.set(pitch, yaw, 0, 'ZYX');
    renderer.render(viewer.scene, viewer.camera);
    return canvas.toBuffer('image/jpeg', { quality: 0.9, progressive: false });
}

export async function disposeViewer(scene) {
    await Promise.all(scene.viewer.world.workers.map(worker => worker.terminate()));
    scene.viewer.resetAll();
    scene.renderer.dispose();
    scene.canvas.__gl__?.getExtension('STACKGL_destroy_context')?.destroy();
}
