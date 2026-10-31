package dev.agentharness.monitor;

import dev.agentharness.monitor.FeedItem.Category;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Shows operators what the agents are doing, from inside the game. Everything goes to individual watchers, never to
 * the server at large, because a public message would wake agents that listen to chat.
 */
public final class AgentMonitorPlugin extends JavaPlugin implements Listener {
    private static final long RECENT_MS = 10 * 60 * 1000;
    private static final int FEED_CHARS = 200;

    private final Map<UUID, Sidebar> sidebars = new HashMap<>();
    private AgentStore store;
    private Watchers watchers;
    private WatchCommand command;

    @Override
    public void onEnable() {
        String configured = System.getenv("AGENT_STATE_DIR");
        Path root = Path.of(configured == null || configured.isBlank() ? "/agent-state" : configured);
        if (!Files.isDirectory(root)) {
            getLogger().warning(root + " does not exist: set AGENT_STATE_DIR to the harness state directory.");
        }
        store = new AgentStore(root, getLogger());
        watchers = new Watchers(this);
        command = new WatchCommand(this, store, watchers);
        getCommand("watch").setExecutor(command);
        getCommand("inv").setExecutor(command);
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimerAsynchronously(this, store::poll, 0, 20);
        getServer().getScheduler().runTaskTimer(this, this::tick, 20, 20);
    }

    @Override
    public void onDisable() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            command.restore(player);
            if (sidebars.containsKey(player.getUniqueId())) {
                player.setScoreboard(Bukkit.getScoreboardManager().getMainScoreboard());
            }
            if (player.getOpenInventory().getTopInventory().getHolder(false) instanceof InventoryView) {
                player.closeInventory();
            }
        }
    }

    private void tick() {
        List<Player> watching = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.hasPermission(Watchers.PERMISSION)) watching.add(player);
        }
        updateSidebars(watching);
        refreshInventories();
        drainFeed(watching);
    }

    private void updateSidebars(List<Player> watching) {
        List<AgentStore.Agent> visible = store.agents().values().stream()
                .filter(a -> a.statusAgeMs() < RECENT_MS || Bukkit.getPlayerExact(a.name()) != null)
                .sorted(java.util.Comparator.comparing(AgentStore.Agent::name))
                .toList();
        List<Component> lines = Sidebar.lines(visible);
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID id = player.getUniqueId();
            if (watching.contains(player) && watchers.sidebar(player)) {
                Sidebar sidebar = sidebars.computeIfAbsent(id, unused -> new Sidebar());
                sidebar.show(lines);
                if (player.getScoreboard() != sidebar.board()) player.setScoreboard(sidebar.board());
            } else if (sidebars.remove(id) != null) {
                player.setScoreboard(Bukkit.getScoreboardManager().getMainScoreboard());
            }
        }
    }

    private void refreshInventories() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getOpenInventory().getTopInventory().getHolder(false) instanceof InventoryView view
                    && !view.refresh()) {
                player.closeInventory();
            }
        }
    }

    private void drainFeed(List<Player> watching) {
        for (FeedItem item = store.feed().poll(); item != null; item = store.feed().poll()) {
            Component line = render(item);
            for (Player player : watching) {
                if (watchers.feed(player).contains(item.category())) player.sendMessage(line);
            }
        }
    }

    private static Component render(FeedItem item) {
        Component line = switch (item.category()) {
            case DMS -> name(item.agent(), NamedTextColor.AQUA)
                    .append(Component.text(" → ", NamedTextColor.GRAY))
                    .append(name(item.recipient(), NamedTextColor.AQUA))
                    .append(Component.text(": " + item.text(), NamedTextColor.WHITE));
            case FAILURES -> name(item.agent(), NamedTextColor.RED)
                    .append(Component.text(" ✗ " + clip(item.text()), NamedTextColor.GRAY));
            case DEATHS -> Component.text("☠ ", NamedTextColor.DARK_RED)
                    .append(name(item.agent(), NamedTextColor.RED))
                    .append(Component.text(" " + item.text(), NamedTextColor.GRAY));
            case TOOLS -> name(item.agent(), NamedTextColor.DARK_GRAY)
                    .append(Component.text(" > " + clip(item.text()), NamedTextColor.DARK_GRAY));
        };
        if (item.detail() == null || item.detail().isBlank()) return line;
        return line.hoverEvent(HoverEvent.showText(Component.text(item.detail())));
    }

    private static Component name(String agent, TextColor color) {
        return Component.text(agent, color)
                .clickEvent(ClickEvent.runCommand("/watch spectate " + agent))
                .hoverEvent(HoverEvent.showText(Component.text("Spectate " + agent)));
    }

    private static String clip(String text) {
        return text.length() > FEED_CHARS ? text.substring(0, FEED_CHARS) + "…" : text;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        Player player = event.getPlayer();
        AgentStore.Agent agent = store.agents().get(player.getName());
        if (agent == null) return;
        Location at = player.getLocation();
        String cause = PlainTextComponentSerializer.plainText()
                .serialize(event.deathMessage() == null ? Component.empty() : event.deathMessage());
        String where = "died at " + at.getBlockX() + ", " + at.getBlockY() + ", " + at.getBlockZ()
                + ", doing " + agent.activity().label();
        store.feed().add(FeedItem.death(player.getName(), where, cause));
    }

    @EventHandler
    public void onClick(InventoryClickEvent event) {
        if (event.getInventory().getHolder(false) instanceof InventoryView) event.setCancelled(true);
    }

    @EventHandler
    public void onDrag(InventoryDragEvent event) {
        if (event.getInventory().getHolder(false) instanceof InventoryView) event.setCancelled(true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        command.restore(player);
        sidebars.remove(player.getUniqueId());
    }
}
