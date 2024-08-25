require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser');
const { generateSlug } = require('random-word-slugs')
const AWS = require('aws-sdk');
const { ECSClient, RunTaskCommand, StopTaskCommand } = require('@aws-sdk/client-ecs')
const { Server } = require('socket.io')
const Redis = require('ioredis')
var cors = require('cors');

const app = express()
const PORT = 9000

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

const subscriber = new Redis(process.env.REDIS_URL)
const io = new Server({ cors: '*' })

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', `Joined: ${channel}`)
    })
})

io.listen(9001, () => {
    console.log('Socket Server running on 9001')
})

// Function to check bucket availability
async function checkBucketAvailability(s3, bucketName) {
    try {
        await s3.headBucket({ Bucket: bucketName }).promise();
        // If no error, bucket exists
        return false;
    } catch (error) {
        if (error.statusCode === 404) {
            // Bucket does not exist
            return true;
        }
        // Other errors (e.g., forbidden access)
        throw error;
    }
}

// Function to generate a unique bucket name
async function generateUniqueBucketName(s3) {
    let available = false;
    let bucketName;
    while (!available) {
        bucketName = generateSlug();
        available = await checkBucketAvailability(s3, bucketName);
    }
    return bucketName;
}

// Function to turn off Block Public Access settings for the bucket
async function disableBlockPublicAccess(s3, bucketName) {
    const params = {
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
            // Set all four options to false to disable block public access
            BlockPublicAcls: false,
            IgnorePublicAcls: false,
            BlockPublicPolicy: false,
            RestrictPublicBuckets: false
        }
    };

    try {
        await s3.putPublicAccessBlock(params).promise();
        console.log(`Block Public Access settings turned off for ${bucketName}`);
    } catch (error) {
        console.error('Error disabling Block Public Access:', error);
        throw error; // Rethrow the error for further handling
    }
}

// Function to set public read access on the bucket
async function setBucketPolicyForPublicReadAccess(s3, bucketName) {
    const policy = {
        Version: "2012-10-17",
        Statement: [{
            Sid: "PublicReadGetObject",
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`
        }]
    };

    await s3.putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify(policy),
    }).promise();
}

// Function to delete all objects in the bucket and then the bucket itself
async function emptyAndDeleteBucket(s3, bucketName) {
    const listParams = { Bucket: bucketName };

    // List all objects
    const listedObjects = await s3.listObjectsV2(listParams).promise();
    if (listedObjects.Contents.length === 0) {
        await s3.deleteBucket({ Bucket: bucketName }).promise();
        console.log(`Bucket ${bucketName} deleted.`);
        return;
    }

    // Delete all listed objects
    const deleteParams = {
        Bucket: bucketName,
        Delete: { Objects: listedObjects.Contents.map(({ Key }) => ({ Key })) },
    };
    await s3.deleteObjects(deleteParams).promise();

    // If the bucket was not empty, repeat to ensure all objects are deleted
    if (listedObjects.IsTruncated) await emptyAndDeleteBucket(bucketName);
    else {
        await s3.deleteBucket({ Bucket: bucketName }).promise();
        console.log(`Bucket ${bucketName} deleted.`);
    }
}

const ecsClient = new ECSClient({
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
})

const config = {
    CLUSTER: process.env.AWS_BUILD_CLUSTER,
    TASK: process.env.AWS_BUILD_TASK
}

app.use(express.json())

app.get('/', (req, res) => {
    res.send("API Server is running...")
})

app.post('/project', async (req, res) => {
    const { gitURL, installCommand, buildCommand, location } = req.body
    // const projectSlug = slug ? slug : generateSlug()
    const bucketLocation = location !== '' ? location : process.env.AWS_REGION
    const awsConfig = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: bucketLocation,
    };
    AWS.config.update(awsConfig);
    const s3 = new AWS.S3(awsConfig);

    // Create a new S3 bucket configured for static website hosting
    const bucketName = await generateUniqueBucketName(s3);
    await s3.createBucket({ Bucket: bucketName }).promise();

    const staticHostParams = {
        Bucket: bucketName,
        WebsiteConfiguration: {
            ErrorDocument: {
                Key: 'error.html',
            },
            IndexDocument: {
                Suffix: 'index.html',
            },
        },
    };

    await s3.putBucketWebsite(staticHostParams).promise();
    await disableBlockPublicAccess(s3, bucketName);
    await setBucketPolicyForPublicReadAccess(s3, bucketName);

    // Schedule the bucket for deletion 10 minutes after creation
    setTimeout(() => {
        emptyAndDeleteBucket(s3, bucketName)
            .then(() => console.log(`Bucket ${bucketName} and its contents have been deleted after 10 minutes.`))
            .catch(err => console.error(`Error while deleting bucket ${bucketName}:`, err));
    }, 600000);

    // Spin the container
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: ['subnet-082b82a29a054e11a', 'subnet-0f12d8bddde47477e', 'subnet-0fd482501205310c9', 'subnet-0470b824371f55363', 'subnet-04e3b60b1ab3ff862', 'subnet-0ab57e8aa37a8de33'],
                securityGroups: ['sg-076de8251bbfcf339']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'build-image',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: gitURL },
                        { name: 'PROJECT_ID', value: bucketName },
                        { name: 'INSTALL_COMMAND', value: installCommand },
                        { name: 'BUILD_COMMAND', value: buildCommand },
                        { name: 'LOCATION', value: bucketLocation }
                    ]
                }
            ]
        }
    })

    // Send the RunTaskCommand to start the task
    // await ecsClient.send(command);
    const runResponse = await ecsClient.send(command);

    // Assuming the task runs successfully, grab the first task ARN from the response
    const taskArn = runResponse.tasks && runResponse.tasks[0] && runResponse.tasks[0].taskArn;

    // Send the StopTaskCommand to stop the task after 7.5 minutes
    if (taskArn) {
        setTimeout(async () => {
            const stopTaskCommand = new StopTaskCommand({
                cluster: config.CLUSTER,
                task: taskArn,
                reason: 'Stopping task after 1 minutes.'
            });
            await ecsClient.send(stopTaskCommand);
        }, 450000);
    }

    return res.json(
        {
            status: 'queued',
            data: {
                projectSlug: bucketName,
                url: `http://${bucketName}.s3-website.${bucketLocation}.amazonaws.com`
            }
        }
    )
})

async function initRedisSubscribe() {
    console.log('Subscribed to logs...')
    subscriber.psubscribe('logs:*')
    subscriber.on('pmessage', (pattern, channel, message) => {
        io.to(channel).emit('message', message)
    })
}

initRedisSubscribe()
app.listen(PORT, () => console.log(`API Server Running..${PORT}`))