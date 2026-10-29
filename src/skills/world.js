import pf from 'mineflayer-pathfinder';
import { isBlockVisible, isEntityVisible, SIGHT_RANGE } from './perception.js';
import * as mc from '../body/bot.js';

export function getNearestFreeSpace(bot, size = 1, distance = 8) {
    let empty_pos = bot.findBlocks({
        matching: block => {
            return block && block.name == 'air';
        },
        maxDistance: distance,
        count: 1000,
    });
    for (let i = 0; i < empty_pos.length; i++) {
        let empty = true;
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                let top = bot.blockAt(empty_pos[i].offset(x, 0, z));
                let bottom = bot.blockAt(empty_pos[i].offset(x, -1, z));
                if (!top || !top.name == 'air' || !bottom || bottom.drops.length == 0 || !bottom.diggable) {
                    empty = false;
                    break;
                }
            }
            if (!empty) break;
        }
        if (empty) {
            return empty_pos[i];
        }
    }
}

export function getBlockAtPosition(bot, x = 0, y = 0, z = 0) {
    let block = bot.blockAt(bot.entity.position.offset(x, y, z));
    if (!block) block = { name: 'air' };

    return block;
}

export function getSurroundingBlocks(bot) {
    let res = [];
    res.push(`Block Below: ${getBlockAtPosition(bot, 0, -1, 0).name}`);
    res.push(`Block at Legs: ${getBlockAtPosition(bot, 0, 0, 0).name}`);
    res.push(`Block at Head: ${getBlockAtPosition(bot, 0, 1, 0).name}`);

    return res;
}

export function getFirstBlockAboveHead(bot, ignore_types = null, distance = 32) {
    let ignore_blocks = [];
    if (ignore_types === null) ignore_blocks = ['air', 'cave_air'];
    else {
        if (!Array.isArray(ignore_types)) ignore_types = [ignore_types];
        for (let ignore_type of ignore_types) {
            if (mc.getBlockId(ignore_type)) ignore_blocks.push(ignore_type);
        }
    }
    let block_above = { name: 'air' };
    let height = 0;
    for (let i = 0; i < distance; i++) {
        let block = bot.blockAt(bot.entity.position.offset(0, i + 2, 0));
        if (!block) block = { name: 'air' };
        if (ignore_blocks.includes(block.name)) continue;
        block_above = block;
        height = i;
        break;
    }

    if (ignore_blocks.includes(block_above.name)) return 'none';

    return `${block_above.name} (${height} blocks up)`;
}

export function getNearestBlocks(bot, block_types = null, distance = 8, count = 10000) {
    let block_ids = [];
    if (block_types === null) {
        block_ids = mc.getAllBlockIds(['air']);
    } else {
        if (!Array.isArray(block_types)) block_types = [block_types];
        for (let block_type of block_types) {
            block_ids.push(mc.getBlockId(block_type));
        }
    }
    return getNearestBlocksWhere(bot, block_ids, distance, count);
}

export function getNearestBlocksWhere(bot, predicate, distance = 8, count = 10000) {
    let positions = bot.findBlocks({
        matching: predicate,
        maxDistance: Math.min(distance, SIGHT_RANGE),
        count,
        useExtraInfo: block => isBlockVisible(bot, block, distance),
    });
    let blocks = positions.map(position => bot.blockAt(position));
    return blocks;
}

export function getNearestBlock(bot, block_type, distance = 16) {
    let blocks = getNearestBlocks(bot, block_type, distance, 1);
    if (blocks.length > 0) {
        return blocks[0];
    }
    return null;
}

export function getNearbyEntities(bot, maxDistance = 16) {
    let entities = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance || !isEntityVisible(bot, entity, maxDistance)) continue;
        entities.push({ entity: entity, distance: distance });
    }
    entities.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < entities.length; i++) {
        res.push(entities[i].entity);
    }
    return res;
}

export function getNearestEntityWhere(bot, predicate, maxDistance = 16) {
    return bot.nearestEntity(entity => predicate(entity) && isEntityVisible(bot, entity, maxDistance));
}

export function getNearbyPlayers(bot, maxDistance) {
    if (maxDistance == null) maxDistance = 16;
    let players = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance || !isEntityVisible(bot, entity, maxDistance)) continue;
        if (entity.type == 'player' && entity.username != bot.username) {
            players.push({ entity: entity, distance: distance });
        }
    }
    players.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < players.length; i++) {
        res.push(players[i].entity);
    }
    return res;
}

export function getVillagerProfession(entity) {
    const professions = {
        0: 'Unemployed',
        1: 'Armorer',
        2: 'Butcher',
        3: 'Cartographer',
        4: 'Cleric',
        5: 'Farmer',
        6: 'Fisherman',
        7: 'Fletcher',
        8: 'Leatherworker',
        9: 'Librarian',
        10: 'Mason',
        11: 'Nitwit',
        12: 'Shepherd',
        13: 'Toolsmith',
        14: 'Weaponsmith',
    };

    if (entity.metadata && entity.metadata[18]) {
        if (typeof entity.metadata[18] === 'object' && entity.metadata[18].villagerProfession !== undefined) {
            const professionId = entity.metadata[18].villagerProfession;
            const level = entity.metadata[18].level || 1;
            const professionName = professions[professionId] || 'Unknown';
            return `${professionName} L${level}`;
        } else if (typeof entity.metadata[18] === 'number') {
            const professionId = entity.metadata[18];
            return professions[professionId] || 'Unknown';
        }
    }

    if (entity.metadata && entity.metadata[16] !== 1) {
        return 'Adult';
    }

    return 'Unknown';
}

export function getInventoryCounts(bot) {
    let inventory = {};
    for (const slot of bot.inventory.slots) {
        if (slot != null && slot.name) {
            if (inventory[slot.name] == null) {
                inventory[slot.name] = 0;
            }
            inventory[slot.name] += slot.count;
        }
    }
    return inventory;
}

export function getCraftableItems(bot) {
    let table = getNearestBlock(bot, 'crafting_table');
    if (!table) {
        for (const item of bot.inventory.items()) {
            if (item != null && item.name === 'crafting_table') {
                table = item;
                break;
            }
        }
    }
    let res = [];
    for (const item of mc.getAllItems()) {
        let recipes = bot.recipesFor(item.id, null, 1, table);
        if (recipes.length > 0) res.push(item.name);
    }
    return res;
}

export function getPosition(bot) {
    return bot.entity.position;
}

export function getNearbyEntityTypes(bot) {
    let mobs = getNearbyEntities(bot, 16);
    let found = [];
    for (let i = 0; i < mobs.length; i++) {
        if (!found.includes(mobs[i].name)) {
            found.push(mobs[i].name);
        }
    }
    return found;
}

export function isEntityType(name) {
    return mc.getEntityId(name) !== null;
}

export function getNearbyPlayerNames(bot) {
    let players = getNearbyPlayers(bot, 64);
    let found = [];
    for (let i = 0; i < players.length; i++) {
        if (!found.includes(players[i].username) && players[i].username != bot.username) {
            found.push(players[i].username);
        }
    }
    return found;
}

export function getNearbyBlockTypes(bot, distance = 16) {
    let blocks = getNearestBlocks(bot, null, distance);
    let found = [];
    for (let i = 0; i < blocks.length; i++) {
        if (!found.includes(blocks[i].name)) {
            found.push(blocks[i].name);
        }
    }
    return found;
}

export async function isClearPath(bot, target) {
    let movements = new pf.Movements(bot);
    movements.canDig = false;
    movements.canPlaceOn = false;
    movements.canOpenDoors = false;
    let goal = new pf.goals.GoalNear(target.position.x, target.position.y, target.position.z, 1);
    let path = await bot.pathfinder.getPathTo(movements, goal, 100);
    return path.status === 'success';
}

export function shouldPlaceTorch(bot) {
    if (!bot.modes.isOn('torch_placing') || bot.interrupt_code) return false;
    const pos = getPosition(bot);
    let nearest_torch = getNearestBlock(bot, 'torch', 6);
    if (!nearest_torch) nearest_torch = getNearestBlock(bot, 'wall_torch', 6);
    if (!nearest_torch) {
        const block = bot.blockAt(pos);
        let has_torch = bot.inventory.findInventoryItem('torch');
        return has_torch && block?.name === 'air';
    }
    return false;
}

export function getBiomeName(bot) {
    const biomeId = bot.world.getBiome(bot.entity.position);
    return mc.getAllBiomes()[biomeId].name;
}
