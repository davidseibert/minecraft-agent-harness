package dev.agentharness.monitor;

import dev.agentharness.monitor.FeedItem.Category;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Per-player monitor settings, stored on the player so they survive restarts. */
final class Watchers {
    static final String PERMISSION = "agentmonitor.watch";
    private static final Set<Category> DEFAULT_FEED = EnumSet.of(Category.DMS, Category.FAILURES, Category.DEATHS);

    private final NamespacedKey feedKey;
    private final NamespacedKey sidebarKey;

    Watchers(Plugin plugin) {
        feedKey = new NamespacedKey(plugin, "feed");
        sidebarKey = new NamespacedKey(plugin, "sidebar");
    }

    Set<Category> feed(Player player) {
        String stored = player.getPersistentDataContainer().get(feedKey, PersistentDataType.STRING);
        if (stored == null) return EnumSet.copyOf(DEFAULT_FEED);
        Set<Category> feed = EnumSet.noneOf(Category.class);
        Arrays.stream(Category.values()).filter(c -> Arrays.asList(stored.split(",")).contains(c.id())).forEach(feed::add);
        return feed;
    }

    boolean toggle(Player player, Category category) {
        Set<Category> feed = feed(player);
        boolean on = feed.add(category);
        if (!on) feed.remove(category);
        String stored = feed.stream().map(Category::id).collect(Collectors.joining(","));
        player.getPersistentDataContainer().set(feedKey, PersistentDataType.STRING, stored);
        return on;
    }

    boolean sidebar(Player player) {
        return player.getPersistentDataContainer().getOrDefault(sidebarKey, PersistentDataType.BOOLEAN, true);
    }

    boolean toggleSidebar(Player player) {
        PersistentDataContainer data = player.getPersistentDataContainer();
        boolean on = !sidebar(player);
        data.set(sidebarKey, PersistentDataType.BOOLEAN, on);
        return on;
    }
}
