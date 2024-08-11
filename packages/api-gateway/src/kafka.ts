import { Kafka, logLevel } from "kafkajs";
export function createKafka(clientId: string) {
  const brokers = (process.env.KAFKA_BROKERS || "kafka:9092").split(",");
  return new Kafka({ clientId, brokers, logLevel: logLevel.INFO });
}
