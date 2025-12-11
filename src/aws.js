const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');
const { info } = require('@actions/core');

// User data scripts are run as the root user
function getCloudWatchSetupScript() {
  return [
    '# Install CloudWatch Agent for Ubuntu',
    'wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb',
    'sudo dpkg -i amazon-cloudwatch-agent.deb',
    'rm amazon-cloudwatch-agent.deb',
    '',
    '# Create CloudWatch Agent config',
    'sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc',
    "sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << 'EOF'",
    '{',
    '  "agent": {',
    '    "metrics_collection_interval": 60,',
    '    "run_as_user": "root"',
    '  },',
    '  "metrics": {',
    '    "namespace": "GithubActions/Runners",',
    '    "append_dimensions": {',
    '      "InstanceId": "${aws:InstanceId}"',
    '    },',
    '    "metrics_collected": {',
    '      "mem": {',
    '        "measurement": ["mem_used_percent", "mem_available", "mem_total", "mem_used"],',
    '        "metrics_collection_interval": 60',
    '      },',
    '      "swap": {',
    '        "measurement": ["swap_used_percent", "swap_used", "swap_free"],',
    '        "metrics_collection_interval": 60',
    '      },',
    '      "disk": {',
    '        "measurement": ["disk_used_percent", "disk_free", "disk_used"],',
    '        "resources": ["/"],',
    '        "metrics_collection_interval": 60',
    '      },',
    '      "cpu": {',
    '        "measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"],',
    '        "metrics_collection_interval": 60,',
    '        "totalcpu": true',
    '      }',
    '    }',
    '  }',
    '}',
    'EOF',
    '',
    '# Start CloudWatch Agent',
    'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s',
    ''
  ];
}

function buildUserDataScript(githubRegistrationToken, label) {
  core.info("build script for label "+label);
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    core.info("Have found the runner in AMI so init docker runner ");
    return [
      '#!/bin/bash',
      'sudo systemctl stop unattended-upgrades',
      'sudo systemctl disable unattended-upgrades',
      ...getCloudWatchSetupScript(),
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --replace --unattended`,
      './run.sh',
    ];
  } else {
    core.info("Haven't found the runner so installing it ");
    return [
      '#!/bin/bash',
      'sudo systemctl stop unattended-upgrades',
      'sudo systemctl disable unattended-upgrades',
      ...getCloudWatchSetupScript(),
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'curl -O -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-${RUNNER_ARCH}-2.321.0.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.321.0.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --replace --unattended`,
      'config done successfull now running the runners',
      './run.sh',
      'runners started successfully',
    ];
  }
}

// new function: buildUserDataScriptMulti
function buildUserDataScript_multiRunner(githubRegistrationToken, baseLabel, runnersPerInstance) {
  // baseLabel can be something like "self-hosted,karate,small" or "karate"
  // we'll append an index label per runner for uniqueness: e.g. karate-1
  core.info(`build multi-runner script for baseLabel=${baseLabel} count=${runnersPerInstance}`);

  // If an AMI already has runner preinstalled, we still need to create multiple service runs.
  if (config.input.runnerHomeDir) {
    // Assume actions-runner tool is present and tarball not needed.
    return [
      '#!/bin/bash',
      'set -euxo pipefail',
      'sudo systemctl stop unattended-upgrades',
      'sudo systemctl disable unattended-upgrades',
      ...getCloudWatchSetupScript(),
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > /tmp/pre-runner-script.sh`,
      'source /tmp/pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      // loop to configure multiple runners in separate dirs and services
      `for i in $(seq 1 ${runnersPerInstance}); do`,
      '  RUN_DIR="/opt/actions-runner-$i"',
      '  mkdir -p "$RUN_DIR"',
      '  cd "$RUN_DIR"',
      '  # copy runner binaries from AMI runnerHomeDir',
      `  cp -r "${config.input.runnerHomeDir}/." "$RUN_DIR/"`,
      '  RUNNER_NAME="$(hostname)-runner-$i"',
      // create a distinct label per runner (append index)
      `  LABEL="${baseLabel},${baseLabel}-$i"`,
      `  ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels "$LABEL" --name "$RUNNER_NAME" --replace --unattended`,
      '  sudo ./svc.sh install',
      '  sudo ./svc.sh start',
      'done',
      'echo "All runners configured."'
    ];
  }

  // Default path when AMI doesn't have runner preinstalled: download tar once, then configure N runners
  return [
    '#!/bin/bash',
    'set -euxo pipefail',
    'sudo systemctl stop unattended-upgrades',
    'sudo systemctl disable unattended-upgrades',
    ...getCloudWatchSetupScript(),
    'cd /opt',
    `echo "${config.input.preRunnerScript}" > /tmp/pre-runner-script.sh`,
    'source /tmp/pre-runner-script.sh',
    'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
    // download the tarball only once into /opt
    'RUNNER_VERSION="2.321.0"',
    'TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"',
    'if [ ! -f "/opt/${TARBALL}" ]; then',
    '  curl -sSL -o /opt/${TARBALL} "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"',
    'fi',
    // loop and create multiple runner directories
    `for i in $(seq 1 ${runnersPerInstance}); do`,
    '  RUN_DIR="/opt/actions-runner-$i"',
    '  mkdir -p "$RUN_DIR"',
    '  tar xzf /opt/${TARBALL} -C "$RUN_DIR"',
    '  cd "$RUN_DIR"',
    '  export RUNNER_ALLOW_RUNASROOT=1',
    '  RUNNER_NAME="$(hostname)-runner-$i"',
    // create a distinct label per runner (append index)
    `  LABEL="${baseLabel},${baseLabel}-$i"`,
    `  ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels "$LABEL" --name "$RUNNER_NAME" --unattended --replace`,
    '  sudo ./svc.sh install',
    '  sudo ./svc.sh start',
    'done',
    'echo "All runners configured."'
  ];
}

function buildMarketOptions() {
  if (config.input.marketType === 'spot') {
    return {
      MarketType: config.input.marketType,
      SpotOptions: {
        SpotInstanceType: 'one-time',
      },
    };
  }

  return undefined;
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: config.input.runnerCount,
    MaxCount: config.input.runnerCount,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    InstanceMarketOptions: buildMarketOptions(),
  };

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceIds = result.Instances.map(inst => inst.InstanceId);
    core.info(`AWS EC2 instances ${ec2InstanceIds} are started`);
    return ec2InstanceIds;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}
class ec2InstaceIdWithLabel{
  constructor(label, ec2InstanceId) {
    this.label = label;
    this.ec2InstanceId = ec2InstanceId;
  }

  getLabel() {
    return this.label;
  }

  getEc2InstanceId() {
    return this.ec2InstanceId;
  }
}

async function startEc2withUniqueLabelForEachInstance(maxConfigRunners, githubRegistrationToken, singleInstance = false) {
  core.info(`[DEBUG] Entering startEc2withUniqueLabelForEachInstance. maxConfigRunners=${maxConfigRunners}, singleInstance=${singleInstance}`);
  const ec2InstanceIds = [];
  const ec2InstanceIdWithLabels = [];
  const labels = [];

  const ec2 = new AWS.EC2();
  core.info("[DEBUG] EC2 client created.");

  // CASE 1: single EC2 instance that hosts multiple runners
  if (singleInstance) {
    core.info(`Single-instance mode enabled → launching 1 EC2 instance with ${maxConfigRunners} runners.`);

    // generate a BASE label for the whole instance
    const baseLabel = config.generateRandomString(60);
    core.info(`[DEBUG] Generated baseLabel: ${baseLabel}`);

    // build multi-runner user-data
    const userData = buildUserDataScript_multiRunner(
      githubRegistrationToken,
      baseLabel,
      maxConfigRunners
    );
    core.info(`[DEBUG] User data script built.`);

    const params = {
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(userData.join('\n')).toString('base64'),
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      TagSpecifications: config.tagSpecifications,
      KeyName: config.awsKeyPair,
      InstanceMarketOptions: buildMarketOptions()
    };

    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;

    core.info(`Launched EC2 instance ${ec2InstanceId} with ${maxConfigRunners} runners.`);

    // compute all labels (baseLabel-1, baseLabel-2, ...)
    const instanceLabels = [];
    for (let r = 1; r <= maxConfigRunners; r++) {
      instanceLabels.push(`${baseLabel}-${r}`);
      labels.push(`${baseLabel}-${r}`);
    }

    ec2InstanceIds.push(ec2InstanceId);
    ec2InstanceIdWithLabels.push({
      instanceId: ec2InstanceId,
      labels: instanceLabels
    });

    return [ec2InstanceIdWithLabels, ec2InstanceIds, labels];
  }

  // CASE 2: multi-instance mode → existing normal behaviour
  core.info(`Multi-instance mode → launching ${maxConfigRunners} instances (1 runner each)`);

  for (let i = 0; i < maxConfigRunners; i++) {
    const labelForThisInstance = config.generateRandomString(60);
    const userData = buildUserDataScript(githubRegistrationToken, labelForThisInstance);

    const params = {
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(userData.join('\n')).toString('base64'),
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      TagSpecifications: config.tagSpecifications,
      KeyName: config.awsKeyPair,
      InstanceMarketOptions: buildMarketOptions()
    };

    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;

    core.info(`Started EC2 instance ${ec2InstanceId} with label ${labelForThisInstance}`);

    ec2InstanceIds.push(ec2InstanceId);
    ec2InstanceIdWithLabels.push({
      instanceId: ec2InstanceId,
      labels: [labelForThisInstance]
    });
    labels.push(labelForThisInstance);
  }

  return [ec2InstanceIdWithLabels, ec2InstanceIds, labels];
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: config.input.ec2InstanceIds,
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instances ${config.input.ec2InstanceIds} are terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instances ${config.input.ec2InstanceIds} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceIds) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: ec2InstanceIds,
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instances ${ec2InstanceIds} are up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instances ${ec2InstanceIds} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
  startEc2withUniqueLabelForEachInstance
};
