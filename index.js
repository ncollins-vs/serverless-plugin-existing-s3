'use strict';

const Permissions = require('./Permissions');
const S3          = require('./S3');
const Transformer = require('./Transformer');

class S3Deploy {

  constructor(serverless,options) {

    this.serverless        = serverless;
    this.options           = options;
    this.provider          = this.serverless.getProvider('aws');
    this.s3Facade          = new S3(this.serverless,this.options,this.provider);
    this.lambdaPermissions = new Permissions.Lambda(this.provider);
    this.transformer       = new Transformer(this.lambdaPermissions);
    
    this.serverless.cli.log("Existing S3 is running")
    this.hooks = {
      'after:deploy:deploy': this.functions.bind(this),
    };
  }

  functions(){
    this.serverless.cli.log("functions --> prepare to be executed by s3 buckets ... ");

    this.events = this.transformer.functionsToEvents(this.serverless.service.functions)
    this.events.then(_ => {
      let count = 0;

      return Promise.all( this.events )
        .then( results => results.map( result => {

            const event = result.passthrough;

            /*
            * If we get a 'funciton not found' error message then sls deploy has likely not been
            *  executed. I suppose it could also be 'permissions', but that would require someone
            *  create a wonkey AIM definition in serverless.yml.
            */
            if(result.error && result.error.toLowerCase().startsWith('function not found')){
              if(this.options['continue-on-error']) {
                this.serverless.cli.log(`\t ERROR: It looks like the function ${event.name} has not yet beend deployed, it will be excluded.`);
                event.remove = true;
                return Promise.resolve(event);
              } else {
                throw `It looks like the function ${event.name} has not yet beend deployed (it may not be the only one). You must use 'sls deploy' before doing 'sls s3deploy'.`;
              }
            }

            /*
            * No permissions have been added to this function for any S3 bucket, so create the policy
            *  and return the event when it executes successfully.
            */
            if(result.error && 'the resource you requested does not exist.' === result.error.toLowerCase()){
              return this.lambdaPermissions.createPolicy(event.name,event.existingS3.bucket,event);
            }

            /*
            * If there is no policy on the lambda function allowing the S3 bucket to invoke it
            *  then add it. These policies are named specifically for this lambda function so
            *  existing 'should' be sufficient in ensureing its proper.
            */
            if(!result.statement) {
              return this.lambdaPermissions.createPolicy(event.name,event.existingS3.bucket,event);
            }

            return Promise.resolve(result);
          })
        )
        .then( results => Promise.all(results) )

        /*
        * Transform results
        */
        .then( events => this.transformer.eventsToBucketGroups(events) )
        .then( bucketNotifications => {
          this.bucketNotifications = bucketNotifications;
          this.serverless.cli.log(`functions <-- built ${count} events across ${bucketNotifications.length} buckets. `);
        })
        .then(this.beforeS3.bind(this))
        .then(this.s3.bind(this))
      });
  }

  beforeS3(){
    this.serverless.cli.log("beforeS3 --> ");

    /*
     * Load the current notification configruartions for each bucket that is impacted. This will be used
     *  to filter out changes that have already been applied to the bucket.
     */
    const promises = this.bucketNotifications.map( bucketConfiguration => this.s3Facade.getLambdaNotifications(bucketConfiguration.name) )

    return Promise.all(promises)
      .then( results => {
        this.currentBucketNotifications = results;
        this.serverless.cli.log("beforeS3 <-- ");
      });

  }

  s3(){

    if(this.bucketNotifications && this.bucketNotifications.length !== 0) {

      this.serverless.cli.log("s3 --> initiate requests ...");
      this.serverless.cli.log(JSON.stringify(this.bucketNotifications));

      const promises = this.bucketNotifications
        .map( bucketConfiguration => {
          
          const s3Notifications = this.currentBucketNotifications.find( currentNotification => currentNotification.bucket === bucketConfiguration.name );

          this.serverless.cli.log("before -->");
          this.serverless.cli.log(JSON.stringify(this.bucketNotifications));
          
          /*
           * Remove any events that were previously created. No sense in sending them
           *  across again.
           */
          /*if(s3Notifications && s3Notifications.results.length !== 0) {
            bucketConfiguration.events = bucketConfiguration.events.filter( event => {
              return !s3Notifications.results.find( s3Event => s3Event.Id === this.s3Facade.getId(event) );
            })
          }*/
          
          this.serverless.cli.log("---------");
          this.serverless.cli.log(JSON.stringify(this.bucketNotifications));
          this.serverless.cli.log("<-- after");


          return bucketConfiguration;
        })
        .filter( bucketConfig => bucketConfig.events.length !== 0)
        .map( bucketConfig => this.s3Facade.putLambdaNotification(bucketConfig) )

      return Promise.all(promises)
        .then( results => this.serverless.cli.log(`s3 <-- Complete ${results.length} updates.`) );

    }
  }
}

module.exports = S3Deploy;
