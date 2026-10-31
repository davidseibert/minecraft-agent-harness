FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src src
RUN mvn -q -B package

FROM itzg/minecraft-server:java21
COPY --from=build /src/target/agent-monitor.jar /plugins/agent-monitor.jar
