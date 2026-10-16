/**
 * RECON R2: Routing Behavior on 60 Candidate Questions
 * Evaluates intent classification and engine routing with NO LLM calls.
 */

const fs = require('fs');
const path = require('path');
const { classifyIntent, RULES } = require('../../server/src/agent/intent.classifier');
const { planQuery } = require('../../server/src/core/query.planner');
const { tryAgent } = require('../../server/src/agent/agent');
const { inspectFixture } = require('../lib/v3_oracles');
const { buildSemanticModel } = require('../../server/src/semantic/semantic.builder');
const { createAdapter } = require('../../server/src/ingestion/adapters');

const CANDIDATE_QUESTIONS = [
  // 1. Counts (wording variants)
  "How many customers are there?",
  "Count the total number of customers.",
  "What is the total count of accounts?",
  "Show the number of branches in the system.",
  "List how many active loans exist.",
  "Give me the count of transactions.",
  "Can you tell me how many employees work here?",
  "Display the number of students enrolled.",

  // 2. Filtered Counts
  "How many accounts have a balance greater than 10000?",
  "Count customers living in New York.",
  "How many transactions were completed with status Success?",
  "What is the number of loans with interest rate below 5%?",
  "Count employees in the Engineering department.",
  "Show how many orders were placed by customer 101.",
  "How many patients were admitted with status Discharged?",

  // 3. Sums & Averages
  "What is the average account balance?",
  "Calculate the average transaction amount.",
  "Find the mean salary of all employees.",
  "What is the total balance across all accounts?",
  "Sum the total revenue for this year.",
  "Give me the average loan duration in months.",
  "Show average fee per appointment.",
  "Calculate total expenditure across all departments.",

  // 4. Group-By Top-1
  "Which branch has the highest total balance?",
  "What is the top product category by sales?",
  "Which customer has the maximum number of transactions?",
  "Show the department with the largest number of employees.",
  "Which course has the highest average grade?",
  "Find the doctor with the most appointments.",
  "Which region generated the highest revenue?",

  // 5. Percentages
  "What percentage of accounts are checking accounts?",
  "What is the percentage of loans that are delinquent?",
  "Calculate the share of active customers.",
  "What proportion of transactions are deposits?",
  "What percentage of students have attendance above 75%?",
  "Show the ratio of approved to rejected claims.",

  // 6. 2-4 Table Joins
  "List customers with their branch name and account balance.",
  "Show each transaction along with customer name and account type.",
  "Which customers hold loans at the Downtown branch?",
  "List orders including customer name, product title, and supplier.",
  "Show student names, their enrolled course, and the instructor name.",
  "Display appointments with patient name, doctor name, and clinic location.",
  "List employees, their department title, and manager name.",

  // 7. Date Filters
  "How many accounts were opened in 2026?",
  "What was the total transaction volume after 2025-06-01?",
  "Count appointments scheduled between January and March.",
  "Show all orders placed during the last quarter.",
  "List employees who joined before 2024-01-01.",
  "What is the average transaction amount for transactions in October 2026?",

  // 8. Wording Variants & Interception Triggers
  "Show the balance of all accounts.",
  "List all customer records.",
  "What is the trend of transaction volume over the last 6 months?",
  "What is the monthly revenue trend?",
  "Describe the distribution of account balances.",
  "Show summary statistics for employee salaries.",
  "Compare branch 1 with branch 2.",
  "Compare sales between North and South regions.",
  "What is the correlation between age and account balance?",
  "Forecast total transaction volume for next month.",
  "What happens if interest rates increase by 2%?",
  "Are there any unusual transaction amounts?",
  "Show key metrics for our accounts.",
  "Give me a management report on company performance."
];

async function run() {
  console.log(`Evaluating routing for ${CANDIDATE_QUESTIONS.length} candidate questions...`);

  // Setup sample fixture dataset for agent resolution
  const fixturePath = path.resolve(__dirname, '../../database/bank/B1_community.db');
  const tables = inspectFixture(fixturePath);
  const schema = { tables };
  const adapter = createAdapter('sqlite', { datasetId: 'fixture_b1', location: fixturePath });
  await adapter.connect();

  let semantic;
  try {
    semantic = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });
  } finally {
    await adapter.disconnect();
  }

  const dataset = {
    dataset_id: 'b1_community',
    name: 'B1 Community Bank',
    type: 'sqlite',
    location: fixturePath,
    schema,
    profile: { semantic }
  };

  const { DatasetRegistry } = require('../../server/src/ingestion/dataset.registry');
  const origGet = DatasetRegistry.get;
  DatasetRegistry.get = (id) => (id === dataset.dataset_id ? { ...dataset, status: 'ready' } : origGet.call(DatasetRegistry, id));

  const results = [];
  const intercepted = [];

  for (let i = 0; i < CANDIDATE_QUESTIONS.length; i++) {
    const q = CANDIDATE_QUESTIONS[i];
    const intentRes = classifyIntent(q);

    // Test tryAgent resolution
    let agentResult = { handled: false };
    try {
      agentResult = await tryAgent({ question: q, dataset, policy: null });
    } catch (_) {}

    // Test planQuery resolution
    const plan = planQuery({ question: q, datasetIds: [dataset.dataset_id] });

    let finalRoute;
    if (intentRes.intent === 'action') finalRoute = 'ACTION';
    else if (intentRes.intent === 'report') finalRoute = 'REPORT';
    else if (agentResult.handled) finalRoute = `AGENT (${agentResult.intent})`;
    else finalRoute = plan.routeType; // STRUCTURED

    if (finalRoute !== 'STRUCTURED') {
      intercepted.push({ id: i + 1, question: q, finalRoute, intent: intentRes.intent });
    }

    results.push({
      id: i + 1,
      question: q,
      intent: intentRes.intent,
      rule_regex: intentRes.rule || null,
      agent_handled: agentResult.handled,
      final_route: finalRoute
    });
  }

  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'r2_routing_60.json'), JSON.stringify(results, null, 2), 'utf8');

  console.log(`\nResults written to ${path.join(outDir, 'r2_routing_60.json')}`);
  console.log(`Total questions: ${results.length}`);
  console.log(`Routed to STRUCTURED (SQL pipeline): ${results.filter(r => r.final_route === 'STRUCTURED').length}`);
  console.log(`Intercepted by deterministic tools / agent: ${intercepted.length}`);
  console.log('\nIntercepted questions:');
  for (const item of intercepted) {
    console.log(`  [${item.id}] "${item.question}" -> ${item.finalRoute}`);
  }
}

run().catch(console.error);
