import { migrate } from "@riddlr/db";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

export async function startPostgres(): Promise<{ url: string; container: StartedTestContainer }> {
  const container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({
      POSTGRES_USER: "riddlr",
      POSTGRES_PASSWORD: "riddlr",
      POSTGRES_DB: "riddlr",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
    .start();
  const url = `postgres://riddlr:riddlr@${container.getHost()}:${container.getMappedPort(5432)}/riddlr`;
  await migrate(url);
  return { url, container };
}
