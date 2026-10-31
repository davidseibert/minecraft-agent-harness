package dev.agentharness.monitor;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.agentharness.monitor.Activity.Level;
import org.junit.jupiter.api.Test;

class ActivityTest {
    private static JsonObject status(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    @Test
    void showsTheCurrentAction() {
        Activity activity = Activity.of(status("{\"activeCycle\":true,\"action\":\"place\",\"blocked\":false}"), 1000, 0);
        assertEquals(new Activity("place", Level.ACTIVE), activity);
    }

    @Test
    void showsThinkingBetweenActions() {
        assertEquals("thinking", Activity.of(status("{\"activeCycle\":true,\"action\":null}"), 1000, 0).label());
    }

    @Test
    void showsIdle() {
        assertEquals("idle", Activity.of(status("{\"activeCycle\":false,\"action\":null}"), 1000, 0).label());
    }

    @Test
    void flagsAFailureStreakOverTheAction() {
        Activity activity = Activity.of(status("{\"action\":\"go_to\"}"), 1000, 3);
        assertEquals(new Activity("failing x3", Level.TROUBLE), activity);
    }

    @Test
    void flagsABlockedBody() {
        assertEquals(Level.TROUBLE, Activity.of(status("{\"action\":\"dig\",\"blocked\":true}"), 1000, 0).level());
        assertEquals(Level.TROUBLE, Activity.of(status("{\"blocked\":\"stuck\"}"), 1000, 0).level());
    }

    @Test
    void flagsAStaleHeartbeatFirst() {
        Activity activity = Activity.of(status("{\"action\":\"dig\"}"), Activity.HEARTBEAT_MS + 1, 0);
        assertEquals(new Activity("no heartbeat", Level.TROUBLE), activity);
    }

    @Test
    void waitsForAnAgentStillStarting() {
        assertEquals("starting", Activity.of(null, 1000, 0).label());
    }
}
