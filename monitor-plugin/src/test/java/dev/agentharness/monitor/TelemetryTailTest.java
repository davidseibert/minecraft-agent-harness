package dev.agentharness.monitor;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TelemetryTailTest {
    @TempDir
    Path dir;

    private void append(Path file, String text) throws IOException {
        Files.writeString(file, text, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    @Test
    void skipsHistoryWhenStartingFromTheEnd() throws IOException {
        Path file = dir.resolve("t.jsonl");
        append(file, "old\n");
        TelemetryTail tail = new TelemetryTail(file, true);
        assertEquals(List.of(), tail.poll());
        append(file, "new\n");
        assertEquals(List.of("new"), tail.poll());
    }

    @Test
    void readsFromTheStartOtherwise() throws IOException {
        Path file = dir.resolve("t.jsonl");
        append(file, "one\ntwo\n");
        assertEquals(List.of("one", "two"), new TelemetryTail(file, false).poll());
    }

    @Test
    void holdsBackAPartialLine() throws IOException {
        Path file = dir.resolve("t.jsonl");
        TelemetryTail tail = new TelemetryTail(file, false);
        append(file, "whole\npart");
        assertEquals(List.of("whole"), tail.poll());
        assertEquals(List.of(), tail.poll());
        append(file, "ial\n");
        assertEquals(List.of("partial"), tail.poll());
    }

    @Test
    void keepsMultibyteCharactersSplitAcrossPolls() throws IOException {
        Path file = dir.resolve("t.jsonl");
        TelemetryTail tail = new TelemetryTail(file, false);
        byte[] arrow = "→".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(file, new byte[] {arrow[0]});
        assertEquals(List.of(), tail.poll());
        Files.write(file, new byte[] {arrow[1], arrow[2], '\n'}, StandardOpenOption.APPEND);
        assertEquals(List.of("→"), tail.poll());
    }

    @Test
    void startsOverWhenTheFileShrinks() throws IOException {
        Path file = dir.resolve("t.jsonl");
        TelemetryTail tail = new TelemetryTail(file, false);
        append(file, "a long first line\n");
        tail.poll();
        Files.writeString(file, "x\n");
        assertEquals(List.of("x"), tail.poll());
    }

    @Test
    void waitsForAFileThatDoesNotExistYet() throws IOException {
        Path file = dir.resolve("t.jsonl");
        TelemetryTail tail = new TelemetryTail(file, true);
        assertEquals(List.of(), tail.poll());
        append(file, "first\n");
        assertEquals(List.of("first"), tail.poll());
    }
}
