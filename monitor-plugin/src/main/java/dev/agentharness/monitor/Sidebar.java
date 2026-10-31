package dev.agentharness.monitor;

import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;

/** A private scoreboard for one watcher. Agents stay on the main scoreboard and never see it. */
final class Sidebar {
    private static final int MAX_LINES = 15;

    private final Scoreboard board = Bukkit.getScoreboardManager().getNewScoreboard();
    private final Objective objective;
    private int shown;

    Sidebar() {
        objective = board.registerNewObjective(
                "agents", Criteria.DUMMY, Component.text("Agents", NamedTextColor.GOLD));
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        objective.numberFormat(NumberFormat.blank());
    }

    Scoreboard board() {
        return board;
    }

    void show(List<Component> lines) {
        for (int i = 0; i < lines.size(); i++) {
            var score = objective.getScore("line" + i);
            score.setScore(MAX_LINES - i);
            score.customName(lines.get(i));
        }
        for (int i = lines.size(); i < shown; i++) board.resetScores("line" + i);
        shown = lines.size();
    }

    /** Two lines per agent, or one when they would not all fit. */
    static List<Component> lines(Collection<AgentStore.Agent> agents) {
        List<Component> lines = new ArrayList<>();
        boolean detail = agents.size() * 2 <= MAX_LINES;
        for (AgentStore.Agent agent : agents) {
            if (lines.size() >= MAX_LINES) break;
            Player player = Bukkit.getPlayerExact(agent.name());
            Component vitals = Component.text(agent.name(), NamedTextColor.WHITE);
            if (player == null) {
                lines.add(vitals.append(Component.text(" offline", NamedTextColor.DARK_GRAY)));
                continue;
            }
            int health = (int) Math.ceil(player.getHealth());
            vitals = vitals.append(Component.text(" ❤" + health, health <= 6 ? NamedTextColor.RED : NamedTextColor.GREEN))
                    .append(Component.text(" ●" + player.getFoodLevel(), NamedTextColor.GOLD));
            Component activity = Component.text(agent.activity().label(), color(agent.activity().level()));
            if (detail) {
                lines.add(vitals);
                lines.add(Component.text(" ").append(activity)
                        .append(Component.text(" " + held(player), NamedTextColor.GRAY)));
            } else {
                lines.add(vitals.append(Component.text(" ")).append(activity));
            }
        }
        if (lines.isEmpty()) lines.add(Component.text("no agents found", NamedTextColor.GRAY));
        return lines;
    }

    private static String held(Player player) {
        Material item = player.getInventory().getItemInMainHand().getType();
        return item.isAir() ? "" : item.name().toLowerCase(Locale.ROOT);
    }

    private static TextColor color(Activity.Level level) {
        return switch (level) {
            case ACTIVE -> NamedTextColor.GREEN;
            case WAITING -> NamedTextColor.YELLOW;
            case TROUBLE -> NamedTextColor.RED;
        };
    }
}
