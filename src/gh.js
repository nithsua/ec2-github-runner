const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunners(label,isDeleteFlow) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);

      if (!isDeleteFlow) {
        // core.info(`[DEBUG] Finding runners with label: ${label}`);
        const foundRunners = runners.filter(runner => runner.labels.some(labelObj => labelObj.name === label));
        // core.info(`[DEBUG] Found ${foundRunners.length} runners for label ${label}`);
        return foundRunners;

      } else {
        // core.info(`[DEBUG] Finding runners with labels: ${label} (Delete Flow)`);
        const labels = JSON.parse(label); // Assuming label is a JSON string array in delete flow
        const foundRunners = runners.filter(runner => runner.labels.some(labelObj => labels.includes(labelObj.name)));
        // core.info(`[DEBUG] Found ${foundRunners.length} runners for delete flow`);
        return foundRunners;
      }
  } catch (error) {
    core.error(`GitHub self-hosted runner receiving error: ${error.message}`);
    return [];
  }

}


// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  core.info("[DEBUG] Entering getRegistrationToken");
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

async function removeRunner() {
  const runners = await getRunners(config.input.label,true);
  const octokit = github.getOctokit(config.input.githubToken);
  core.info(`got runners like this in background ${JSON.stringify(runners)} and levels from config ${JSON.stringify(config.input.label)}`);
  // skip the runner removal process if the runner is not found
  if (runners===undefined) {
    core.info(`GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`);
    return;
  }

  const errors = [];
  for (const runner of runners) {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    } catch (error) {
      core.error(`GitHub self-hosted runner removal error: ${error}`);
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    core.setFailed('Failures occurred when removing runners.');
  }

}
async function waitForRunnerRegistered(label, timeoutMinutes, retryIntervalSeconds) {
  const maxSeconds = timeoutMinutes * 60;
  let elapsedSeconds = 0;

  while (elapsedSeconds < maxSeconds) {
    try {
      const runners = await getRunners(label, false);
      core.info(`[DEBUG] Received runners for label ${label}: ${JSON.stringify(runners || [])}`);

      if (runners && runners.length > 0) {
        const allOnline = runners.every(runner => runner.status === 'online');
        if (allOnline) {
          core.info(`GitHub self-hosted runner(s) for label ${label} are registered and ready to use.`);
          return;
        } else {
          const statuses = runners.map(r => `${r.name}:${r.status}`).join(', ');
          core.info(`Found ${runners.length} runner(s) for label ${label}, but not all are online. Statuses: [${statuses}]. Waiting...`);
        }
      } else {
        core.info(`No runners found for label ${label} yet. Waiting...`);
      }
    } catch (error) {
      core.error(`Error checking runner status for ${label}: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, retryIntervalSeconds * 1000));
    elapsedSeconds += retryIntervalSeconds;
  }

  throw new Error(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance with label ${label} was not able to register itself in GitHub as a new self-hosted runner.`);
}
async function waitForRunnersRegistered(labels) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 10;
  const quietPeriodSeconds = 30;


  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instances to be registered in GitHub as new self-hosted runners`);
  await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runners are registered`);

  const promises = await Promise.all(
    labels.map(label => waitForRunnerRegistered(label, timeoutMinutes, retryIntervalSeconds))
  );
  return promises;
}



module.exports = {
  getRegistrationToken,
  removeRunner,
  waitForRunnerRegistered,
  waitForRunnersRegistered,
  getRunners,
};
