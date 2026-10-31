package dev.agentharness.monitor;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Follows the harness state directory. poll() runs off the main thread; readers get immutable snapshots. */
final class AgentStore {
    record Agent(String name, Activity activity, long statusAgeMs) {}

    private final Path root;
    private final Logger log;
    private final Map<String, TelemetryTail> tails = new HashMap<>();
    private final Map<String, Integer> failures = new HashMap<>();
    private final Queue<FeedItem> feed = new ConcurrentLinkedQueue<>();
    private volatile Map<String, Agent> agents = Map.of();
    private boolean firstPoll = true;

    AgentStore(Path root, Logger log) {
        this.root = root;
        this.log = log;
    }

    Map<String, Agent> agents() {
        return agents;
    }

    /** Waiting feed items, oldest first. Safe to use from any thread. */
    Queue<FeedItem> feed() {
        return feed;
    }

    synchronized void poll() {
        Map<String, Agent> next = new TreeMap<>();
        for (Path dir : agentDirs()) {
            String name = dir.getFileName().toString();
            try {
                follow(name, dir);
                long age = System.currentTimeMillis() - Files.getLastModifiedTime(dir.resolve("status.json")).toMillis();
                JsonObject status = read(dir.resolve("runtime-status.json"));
                next.put(name, new Agent(name, Activity.of(status, age, failures.getOrDefault(name, 0)), age));
            } catch (IOException e) {
                log.log(Level.FINE, "Could not read agent " + name, e);
            }
        }
        agents = Map.copyOf(next);
        firstPoll = false;
    }

    private List<Path> agentDirs() {
        List<Path> dirs = new ArrayList<>();
        if (!Files.isDirectory(root)) return dirs;
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(root)) {
            for (Path entry : entries) {
                if (Files.exists(entry.resolve("status.json"))) dirs.add(entry);
            }
        } catch (IOException e) {
            log.log(Level.WARNING, "Could not list " + root, e);
        }
        return dirs;
    }

    private void follow(String name, Path dir) throws IOException {
        TelemetryTail tail = tails.get(name);
        if (tail == null) {
            // Skip history on startup, but read an agent that appears later from its beginning.
            tail = new TelemetryTail(dir.resolve("telemetry.jsonl"), firstPoll);
            tails.put(name, tail);
        }
        for (String line : tail.poll()) {
            FeedItem.parse(line).ifPresent(item -> {
                if (item.streak() == FeedItem.Streak.BUMP) failures.merge(name, 1, Integer::sum);
                if (item.streak() == FeedItem.Streak.RESET) failures.remove(name);
                feed.add(item);
            });
        }
    }

    private static JsonObject read(Path file) throws IOException {
        if (!Files.exists(file)) return null;
        try {
            JsonElement element = JsonParser.parseString(Files.readString(file));
            return element.isJsonObject() ? element.getAsJsonObject() : null;
        } catch (JsonParseException e) {
            return null;
        }
    }
}
