const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceIds) {
  core.info(`setting output label:${label}  ec2InstanceIds:${ec2InstanceIds} ${typeof ec2InstanceIds}`);
  core.setOutput('label', label);
  core.setOutput('ec2-instance-ids', ec2InstanceIds);
}

async function start() {
  core.info("RocketLaneStage")
  //const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  //const ec2InstanceIds = await aws.startEc2Instance(label, githubRegistrationToken);
  const [ec2InstaceIdWithLabels,ec2InstacesIds,labels]=await aws.startEc2withUniqueLabelForEachInstance(config.input.runnerCount,githubRegistrationToken, config.input.singleInstance);
  core.info(`ec2InstaceId labels:-${ec2InstaceIdWithLabels}`);
  core.info(`labels created :- ${labels}`)
  core.info(`ec2Intances created :-${ec2InstacesIds}`);
  setOutput(labels, ec2InstacesIds);
  await aws.waitForInstanceRunning(ec2InstacesIds);
  await gh.waitForRunnersRegistered(labels);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

async function defaults() {
  core.warning("Runner is falling to default github runner");
  const runner_count=config.input.runnerCount;
  core.info(`RunnerCount ${runner_count}`);
  const labels = Array.from({ length: runner_count }, () => "ubuntu-latest");
  const ec2RunnerHostName =  Array.from({ length: runner_count }, () => "i-ROCKETBYROHAN");
  core.info(`setting output label:${labels} `)
  core.info(`setting output label:${ec2RunnerHostName} `)
  core.setOutput('label', labels);
  core.setOutput('ec2-instance-ids', ec2RunnerHostName);
}

(async function () {
  try {
    switch (config.input.mode) {
      case 'start':
        return await start();
      case 'stop':
        return await stop();
      case 'default':
        return await defaults();
      default:
        throw new Error(`Invalid mode: ${config.input.mode}`);
    }
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();