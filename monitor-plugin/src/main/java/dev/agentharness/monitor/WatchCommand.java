package dev.agentharness.monitor;

import dev.agentharness.monitor.FeedItem.Category;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** /watch and /inv. */
final class WatchCommand implements TabExecutor {
    private record Return(Location location, GameMode mode) {}

    private final Plugin plugin;
    private final AgentStore store;
    private final Watchers watchers;
    private final Map<UUID, Return> returns = new HashMap<>();

    WatchCommand(Plugin plugin, AgentStore store, Watchers watchers) {
        this.plugin = plugin;
        this.store = store;
        this.watchers = watchers;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use this.");
            return true;
        }
        if (command.getName().equals("inv")) {
            if (args.length != 1) return false;
            withAgent(player, args[0], agent -> player.openInventory(new InventoryView(agent).getInventory()));
            return true;
        }
        if (args.length == 0) {
            roster(player);
            return true;
        }
        String action = args[0].toLowerCase(Locale.ROOT);
        Optional<Category> category =
                Arrays.stream(Category.values()).filter(c -> c.id().equals(action)).findFirst();
        if (category.isPresent() && args.length == 1) {
            boolean on = watchers.toggle(player, category.get());
            player.sendMessage(note(action + " feed " + (on ? "on" : "off")));
        } else if (action.equals("sidebar") && args.length == 1) {
            player.sendMessage(note("sidebar " + (watchers.toggleSidebar(player) ? "on" : "off")));
        } else if (action.equals("back") && args.length == 1) {
            goBack(player);
        } else if (action.equals("tp") && args.length == 2) {
            withAgent(player, args[1], agent -> teleport(player, agent));
        } else if (action.equals("spectate") && args.length == 2) {
            withAgent(player, args[1], agent -> spectate(player, agent));
        } else {
            return false;
        }
        return true;
    }

    private void withAgent(Player player, String name, java.util.function.Consumer<Player> action) {
        Player agent = store.agents().containsKey(name) ? Bukkit.getPlayerExact(name) : null;
        if (agent == null) {
            player.sendMessage(Component.text(name + " is not an online agent.", NamedTextColor.RED));
            return;
        }
        action.accept(agent);
    }

    private void teleport(Player player, Player agent) {
        returns.putIfAbsent(player.getUniqueId(), new Return(player.getLocation(), player.getGameMode()));
        if (player.getGameMode() == GameMode.SPECTATOR) player.setSpectatorTarget(null);
        player.teleport(agent);
    }

    private void spectate(Player player, Player agent) {
        returns.putIfAbsent(player.getUniqueId(), new Return(player.getLocation(), player.getGameMode()));
        player.setGameMode(GameMode.SPECTATOR);
        player.setSpectatorTarget(null);
        player.teleport(agent);
        // The client has to arrive and load the target before the camera can attach to it.
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (player.isOnline() && agent.isOnline() && player.getGameMode() == GameMode.SPECTATOR) {
                player.setSpectatorTarget(agent);
            }
        }, 5);
        player.sendMessage(note("spectating " + agent.getName() + ". /watch back returns you."));
    }

    private void goBack(Player player) {
        if (!restore(player)) player.sendMessage(note("nothing to go back to"));
    }

    /** Puts a player back where they were before their first tp or spectate. */
    boolean restore(Player player) {
        Return back = returns.remove(player.getUniqueId());
        if (back == null) return false;
        if (player.getGameMode() == GameMode.SPECTATOR) player.setSpectatorTarget(null);
        player.setGameMode(back.mode());
        player.teleport(back.location());
        return true;
    }

    private void roster(Player player) {
        store.agents().values().stream()
                .filter(agent -> Bukkit.getPlayerExact(agent.name()) != null)
                .forEach(agent -> player.sendMessage(Component.text(agent.name() + " ", NamedTextColor.WHITE)
                        .append(Component.text(agent.activity().label() + " ", NamedTextColor.GRAY))
                        .append(button("[inv]", "/inv " + agent.name()))
                        .append(Component.space())
                        .append(button("[spectate]", "/watch spectate " + agent.name()))
                        .append(Component.space())
                        .append(button("[tp]", "/watch tp " + agent.name()))));
        Component toggles = Component.text("Feed:", NamedTextColor.GRAY);
        Set<Category> feed = watchers.feed(player);
        for (Category category : Category.values()) {
            String id = category.id();
            toggles = toggles.append(Component.space())
                    .append(Component.text(
                                    id,
                                    feed.contains(category) ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY)
                            .clickEvent(ClickEvent.runCommand("/watch " + id))
                            .hoverEvent(HoverEvent.showText(Component.text("Toggle " + id))));
        }
        player.sendMessage(toggles.append(Component.text("  ")).append(button("[back]", "/watch back")));
    }

    private static Component button(String label, String command) {
        return Component.text(label, NamedTextColor.AQUA)
                .clickEvent(ClickEvent.runCommand(command))
                .hoverEvent(HoverEvent.showText(Component.text(command)));
    }

    private static Component note(String text) {
        return Component.text(text, NamedTextColor.GRAY);
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String label, String[] args) {
        List<String> options = new ArrayList<>();
        boolean wantsAgent = command.getName().equals("inv")
                ? args.length == 1
                : args.length == 2 && (args[0].equalsIgnoreCase("tp") || args[0].equalsIgnoreCase("spectate"));
        if (wantsAgent) {
            options.addAll(store.agents().keySet());
        } else if (command.getName().equals("watch") && args.length == 1) {
            Arrays.stream(Category.values()).map(Category::id).forEach(options::add);
            options.addAll(List.of("sidebar", "tp", "spectate", "back"));
        }
        String typed = args[args.length - 1].toLowerCase(Locale.ROOT);
        options.removeIf(option -> !option.toLowerCase(Locale.ROOT).startsWith(typed));
        return options;
    }
}
