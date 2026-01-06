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
  core.info("Getting registration token...");
  const githubRegistrationToken = await gh.getRegistrationToken();
  core.info("Got registration token.");
  //const ec2InstanceIds = await aws.startEc2Instance(label, githubRegistrationToken);
  core.info("Starting EC2 instance(s)...");
  const [ec2InstaceIdWithLabels,ec2InstacesIds,labels]=await aws.startEc2withUniqueLabelForEachInstance(config.input.runnerCount,githubRegistrationToken);
  core.info(`ec2InstaceId labels:-${JSON.stringify(ec2InstaceIdWithLabels)}`);
  core.info(`labels created :- ${JSON.stringify(labels)}`)
  core.info(`ec2Intances created :-${JSON.stringify(ec2InstacesIds)}`);
  setOutput(labels, ec2InstacesIds);
  core.info("Waiting for instance running...");
  await aws.waitForInstanceRunning(ec2InstacesIds);
  core.info("Waiting for runners registered...");
  await gh.waitForRunnersRegistered(labels);
  core.info("Done.");
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