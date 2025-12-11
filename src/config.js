const core = require('@actions/core');
const crypto = require('crypto');
const github = require('@actions/github');



class Config {
  constructor() {
    this.input = {
      mode: core.getInput('mode'),
      githubToken: core.getInput('github-token'),
      ec2ImageId: core.getInput('ec2-image-id'),
      ec2InstanceType: core.getInput('ec2-instance-type'),
      subnetId: core.getInput('subnet-id'),
      securityGroupId: core.getInput('security-group-id'),
      label: core.getInput('label'),
      ec2InstanceIds: JSON.parse(core.getInput('ec2-instance-ids')),
      iamRoleName: core.getInput('iam-role-name'),
      runnerHomeDir: core.getInput('runner-home-dir'),
      preRunnerScript: core.getInput('pre-runner-script'),
      singleInstance: core.getInput('single-instance') === 'true',
      runnerCount: parseInt(core.getInput('runner-count')),
      marketType: core.getInput('market-type'),
    };
    this.awsKeyPair=core.getInput('key-pair');
    const tags = JSON.parse(core.getInput('aws-resource-tags'));
    this.tagSpecifications = null;
    // for now disabling the custom tag rather we will use key-value tag to attach host name for easy approval


    if (tags.length > 0) {
      this.tagSpecifications = [{ResourceType: 'instance', Tags: tags}, {ResourceType: 'volume', Tags: tags}];
    }
    const hostName = core.getInput("host-name")
    if (hostName!=null){
      if (this.tagSpecifications ==null){
        core.info("tag specifications is null  so adding it");
        this.tagSpecifications = [{ResourceType: 'instance', Tags: [{ Key: 'Name', Value: hostName }]}];
      }else{
        //fixme this is kinda hacky way but yeah we are moving forward as this works :)
        this.tagSpecifications.forEach(specs => {
          specs.Tags.push({ Key: 'Name', Value: hostName });
        });
        core.info(`added the tags to the with host name ${hostName}`);
      }
    }else{
      core.info("haven't found any hostname in the parameters");
    }


    // the values of github.context.repo.owner and github.context.repo.repo are taken from
    // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
    // provided by the GitHub Action on the runtime
    this.githubContext = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    };

    //
    // validate input
    //

    if (!this.input.mode) {
      throw new Error(`The 'mode' input is not specified`);
    }

    if (!this.input.githubToken) {
      throw new Error(`The 'github-token' input is not specified`);
    }

    if (this.input.mode === 'start') {
      if (!this.input.ec2ImageId || !this.input.ec2InstanceType || !this.input.subnetId || !this.input.securityGroupId) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode`);
      }
    } else if (this.input.mode === 'stop') {
      if (!this.input.label || !this.input.ec2InstanceIds) {
        throw new Error(`Not all the required inputs are provided for the 'stop' mode`);
      }
    }else if(this.input.mode === 'default'){

    }
    else {
      throw new Error('Wrong mode. Allowed values: start, stop.');
    }
    if (this.marketType?.length > 0 && this.input.marketType !== 'spot') {
      throw new Error(`Invalid 'market-type' input. Allowed values: spot.`);
    }

  }

  generateUniqueLabel() {
    return Math.random().toString(36).substr(2, 15);
  }
  generateRandomString(length) {
    const bytes = crypto.randomBytes(Math.ceil(length / 2));
    const randomString = bytes.toString('hex').slice(0, length);
    const epochTime = Math.floor(Date.now() / 1000); // Get current epoch time in seconds
    return `${randomString}-${epochTime}`;
  }
}

try {
  module.exports = new Config();
} catch (error) {
  core.error(error);
  core.setFailed(error.message);
}
