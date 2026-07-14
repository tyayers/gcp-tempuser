# GCP TempUser
This is a small project to help users self-provision themselves into a Google Cloud project, for example during a hackathon or lab, where anyone should be able to register and get a temp user with certain roles in a Google Cloud project.

![Frontend screenshot](screenshot.jpg)

The user can manage their user, delete it, and open the Google Cloud console with the project pre-selected.

## Deploy
You can deploy this to Cloud Run just by running the `./deploy.sh` script. You will need to take care that the service account user exists and has the correct rights / delegated rights for the Cloud IAM instance to create the user.

```sh
# Deploy to Cloud Run
./deploy.sh
```
