package dev.agentharness.monitor;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;

/**
 * A read-only copy of an agent's inventory. It holds clones, never the real stacks, and the plugin cancels every
 * click, so nothing a watcher does here can reach the agent.
 *
 * <p>Row 1: armor, offhand and vitals. Rows 2-4: backpack. Row 5: hotbar.
 */
final class InventoryView implements InventoryHolder {
    private static final int HOTBAR_ROW = 36;
    private static final int VITALS_SLOT = 8;

    private final UUID target;
    private final Inventory inventory;

    InventoryView(Player agent) {
        target = agent.getUniqueId();
        inventory = Bukkit.createInventory(this, 45, Component.text(agent.getName() + "'s inventory"));
        refresh();
    }

    @Override
    public Inventory getInventory() {
        return inventory;
    }

    /** Returns false once the agent has left, so the caller can close the view. */
    boolean refresh() {
        Player agent = Bukkit.getPlayer(target);
        if (agent == null) return false;
        PlayerInventory source = agent.getInventory();
        put(0, source.getHelmet());
        put(1, source.getChestplate());
        put(2, source.getLeggings());
        put(3, source.getBoots());
        put(4, source.getItemInOffHand());
        inventory.setItem(VITALS_SLOT, vitals(agent));
        for (int slot = 9; slot < 36; slot++) put(slot, source.getItem(slot));
        for (int slot = 0; slot < 9; slot++) put(HOTBAR_ROW + slot, source.getItem(slot));
        return true;
    }

    private void put(int slot, ItemStack item) {
        inventory.setItem(slot, item == null ? null : item.clone());
    }

    private static ItemStack vitals(Player agent) {
        ItemStack paper = new ItemStack(Material.PAPER);
        ItemMeta meta = paper.getItemMeta();
        meta.displayName(Component.text("Health " + (int) Math.ceil(agent.getHealth()) + "  Food " + agent.getFoodLevel()));
        Location at = agent.getLocation();
        String held = agent.getInventory().getItemInMainHand().getType().name().toLowerCase(Locale.ROOT);
        meta.lore(List.of(
                Component.text(at.getBlockX() + ", " + at.getBlockY() + ", " + at.getBlockZ(), NamedTextColor.GRAY),
                Component.text("Holding " + held, NamedTextColor.GRAY)));
        paper.setItemMeta(meta);
        return paper;
    }
}
