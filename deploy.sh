# build
GOOS="linux" GOARCH=amd64 go build
# deploy, add --args=
gcloud beta run deploy gcp-tempuser --source . --no-build --base-image=osonly24 --command=./gcp-tempuser --project $GOOGLE_CLOUD_PROJECT --region $GOOGLE_CLOUD_LOCATION --allow-unauthenticated --env-vars-file .env --service-account ai-service@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com
