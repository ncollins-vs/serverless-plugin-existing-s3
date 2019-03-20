'use strict';

class LambdaPermissions {

    constructor(provider) {
        this.provider = provider;
    }

    getId(functionName, bucketName) {
        return `exS3-v2-${functionName}-${bucketName.replace(/[\.\:\*]/g, '')}`;
    }

    createPolicy(functionName, bucketName, passthrough) {
        const payload = {
            Action: "lambda:InvokeFunction",
            FunctionName: functionName,
            Principal: 's3.amazonaws.com',
            StatementId: this.getId(functionName, bucketName),
            SourceArn: `arn:aws:s3:::${bucketName}`
        };
        return this.provider.request('Lambda', 'addPermission', payload)
            .then(results => {
                console.log("createPolicy", results);
                return Object.assign({}, {
                    statement: this.getStatement({Statement:[this.asJson(results.Statement)]}, passthrough),
                    passthrough
                })
            })
    }

    getPolicy(functionName, passthrough) {
        console.log(`getting policy for ${functionName}`);
        return this.provider.request('Lambda', 'getPolicy', {FunctionName: functionName})
            .then(results => {
                if (!results || !results.Policy) {
                    return {};
                }
                return Object.assign({}, {
                    statement: this.getStatement(this.asJson(results.Policy), passthrough),
                    passthrough
                })
            })
            .catch(error => Object.assign({}, {error: error.message, passthrough}));
    }

    getStatement(policy, event) {
        const policyId = this.getId(event.name, event.existingS3.bucket);
        console.log("policyId", policyId);
        // console.log(policy);
        return policy.Statement.find(statement => statement.Sid === policyId);
    }

    asJson(value) {
        if (!value) {
            return {Statement:[]}
        }
        return typeof value === 'string' ? JSON.parse(value) : value
    }
}

module.exports.Lambda = LambdaPermissions;