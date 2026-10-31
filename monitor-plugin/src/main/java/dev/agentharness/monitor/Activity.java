package dev.agentharness.monitor;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** What the sidebar says an agent is doing, from runtime-status.json and its failure streak. */
record Activity(String label, Level level) {
    enum Level {
        ACTIVE,
        WAITING,
        TROUBLE
    }

    static final long HEARTBEAT_MS = 15_000;
    static final int FAILING_AT = 3;

    static Activity of(JsonObject status, long statusAgeMs, int failures) {
        if (statusAgeMs > HEARTBEAT_MS) return new Activity("no heartbeat", Level.TROUBLE);
        if (status == null) return new Activity("starting", Level.WAITING);
        if (truthy(status.get("blocked"))) return new Activity("blocked", Level.TROUBLE);
        if (truthy(status.get("paused"))) return new Activity("paused", Level.WAITING);
        if (failures >= FAILING_AT) return new Activity("failing x" + failures, Level.TROUBLE);
        String action = action(status.get("action"));
        if (action != null) return new Activity(action, Level.ACTIVE);
        if (truthy(status.get("activeCycle"))) return new Activity("thinking", Level.WAITING);
        return new Activity("idle", Level.WAITING);
    }

    private static String action(JsonElement value) {
        if (value == null || value.isJsonNull()) return null;
        if (value.isJsonPrimitive()) return value.getAsString();
        if (value.isJsonObject() && value.getAsJsonObject().has("name")) {
            return value.getAsJsonObject().get("name").getAsString();
        }
        return null;
    }

    private static boolean truthy(JsonElement value) {
        if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) return false;
        if (value.getAsJsonPrimitive().isBoolean()) return value.getAsBoolean();
        return !value.getAsString().isEmpty();
    }
}
