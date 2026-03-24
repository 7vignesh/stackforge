import { parseArgs } from "util";

const API_URL = "http://localhost:3001/api";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      prompt: {
        type: "string",
        short: "p",
        default: "Build a task management app with teams, roles, auth, and PostgreSQL using React and Express",
      },
    },
    strict: true,
    allowPositionals: true,
  });

  const prompt = values.prompt;
  console.log(`\n🚀 Starting StackForge Generation`);
  console.log(`📝 Prompt: "${prompt}"\n`);

  // 1. Trigger the Generation Job
  console.log(`[1] POST /api/generate...`);
  const generateRes = await fetch(`${API_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!generateRes.ok) {
    console.error(`💥 Failed to start generation: ${generateRes.statusText}`);
    const errorBody = await generateRes.text();
    console.error(errorBody);
    process.exit(1);
  }

  const jobInfo = await generateRes.json();
  const { jobId, streamUrl, jobUrl } = jobInfo;
  console.log(`✅ Job Created! ID: ${jobId}`);
  console.log(`📡 Stream URL: ${streamUrl}`);
  console.log(`📂 Job Data URL: ${jobUrl}\n`);

  // 2. Listen to SSE Stream
  console.log(`[2] Listening to SSE stream for job ${jobId}...\n`);
  
  const streamRes = await fetch(`http://localhost:3001${streamUrl}`, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
    },
  });

  if (!streamRes.body) {
    console.error(`💥 Failed to stream`);
    process.exit(1);
  }

  // Very simple SSE parser for demonstration
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const chunk of lines) {
      if (!chunk.trim()) continue;
      
      const linesInChunk = chunk.split("\n");
      const dataLine = linesInChunk.find((l) => l.startsWith("data: "));
      
      if (dataLine) {
        const dataStr = dataLine.replace("data: ", "");
        try {
          const event = JSON.parse(dataStr);
          formatEvent(event);

          if (event.type === "job_completed" || event.type === "job_failed") {
             // Stop streaming when done
             await fetchJobFinalData(jobId);
             process.exit(event.type === "job_completed" ? 0 : 1);
          }
        } catch (e) {
            // ignore JSON parse errors in stream
        }
      }
    }
  }
}

function formatEvent(event: any) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  
  if (event.type === "job_created") {
    console.log(`[${time}] ✨ Job created for project "${event.payload.projectName}"`);
  } else if (event.type === "agent_started") {
    console.log(`[${time}] ⏳ Agent [${event.agent}] is running...`);
  } else if (event.type === "agent_completed") {
    console.log(`[${time}] ✅ Agent [${event.agent}] finished in ${event.payload.durationMs}ms`);
  } else if (event.type === "agent_failed") {
    console.error(`[${time}] ❌ Agent [${event.agent}] failed: ${event.payload.error}`);
  } else if (event.type === "job_completed") {
    console.log(`\n🎉 [${time}] Job completed in ${event.payload.durationMs}ms total!\n`);
  } else if (event.type === "job_failed") {
    console.error(`\n💥 [${time}] Job failed: ${event.payload.error}\n`);
  }
}

async function fetchJobFinalData(jobId: string) {
    console.log(`[3] Fetching final generated blueprint...\n`);
    const res = await fetch(`${API_URL}/jobs/${jobId}`);
    const data = await res.json();
    
    console.log(`=== BLUEPRINT OVERVIEW ===`);
    console.log(`Project: ${data.projectName}`);
    console.log(`Stack Backend: ${data.blueprint.stack.backend}`);
    console.log(`Stack Frontend: ${data.blueprint.stack.frontend}`);
    console.log(`Entities Planned: ${data.blueprint.entities.length} (${data.blueprint.entities.map((e: any) => e.name).join(', ')})`);
    console.log(`API Routes Planned: ${data.blueprint.routePlan.length}`);
    console.log(`Frontend Pages Planned: ${data.blueprint.frontendPages.length}`);
    console.log(`Files Planned to Generate: ${data.blueprint.generatedFilesPlan.length}`);
    console.log(`Reviewer Notes: ${data.blueprint.reviewerNotes.length} issues flagged`);
    console.log(`==========================\n`);
    console.log(`Run: curl http://localhost:3001/api/jobs/${jobId} to see the exact JSON dump.`);
}

main().catch(console.error);
