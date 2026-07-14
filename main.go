package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	admin "google.golang.org/api/admin/directory/v1"
	"google.golang.org/api/cloudresourcemanager/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/impersonate"
	"google.golang.org/api/option"

	"cloud.google.com/go/compute/metadata"
)

// Server configuration
type Config struct {
	ProjectID   string `json:"projectId"`
	Domain      string `json:"domain"`
	Port        string `json:"port"`
	AdminEmail  string `json:"adminEmail"`
}

type Server struct {
	config           Config
	crmService       *cloudresourcemanager.Service
	directoryService *admin.Service
}

func main() {
	log.Println("Starting Labs Provisioning Service...")

	// 1. Read environment variables
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		// Fallback for local debugging
		projectID = os.Getenv("ANTIGRAVITY_PROJECT_ID")
		if projectID == "" {
			projectID = "default-labs-project"
			log.Printf("Warning: GOOGLE_CLOUD_PROJECT not set, falling back to: %s", projectID)
		} else {
			log.Printf("Using ANTIGRAVITY_PROJECT_ID as fallback: %s", projectID)
		}
	}

	domain := os.Getenv("CLOUD_IDENTITY_DOMAIN")
	adminEmail := os.Getenv("ADMIN_EMAIL")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	// 2. Initialize GCP Cloud Resource Manager client
	crmService, err := cloudresourcemanager.NewService(ctx)
	if err != nil {
		log.Fatalf("Failed to initialize Cloud Resource Manager client: %v", err)
	}

	// 3. Initialize Admin SDK Directory client with scopes
	// Standard Admin SDK scopes for user and domain management
	scopes := []string{
		admin.AdminDirectoryUserScope,
	}
	if domain == "" {
		scopes = append(scopes, admin.AdminDirectoryDomainReadonlyScope)
	}

	var opts []option.ClientOption

	// If admin email is provided for impersonation (domain-wide delegation), configure it
	if adminEmail != "" {
		log.Printf("Admin email provided for Domain-Wide Delegation: %s", adminEmail)
		
		// Get current service account email from metadata server
		saEmail, err := metadata.Email("default")
		if err != nil {
			// Fallback for local testing if running as a service account via env var
			saEmail = os.Getenv("SERVICE_ACCOUNT_EMAIL")
			if saEmail == "" {
				log.Printf("Warning: Failed to fetch service account email from metadata server (%v) and SERVICE_ACCOUNT_EMAIL is not set.", err)
			}
		}

		if saEmail != "" {
			log.Printf("Setting up token source using target principal (service account): %s to impersonate: %s", saEmail, adminEmail)
			ts, err := impersonate.CredentialsTokenSource(ctx, impersonate.CredentialsConfig{
				TargetPrincipal: saEmail,
				Scopes:          scopes,
				Subject:         adminEmail,
			})
			if err != nil {
				log.Fatalf("Failed to initialize impersonated TokenSource for Domain-Wide Delegation: %v", err)
			}
			opts = append(opts, option.WithTokenSource(ts))
		} else {
			log.Println("Warning: Service account email not found. Falling back to default credentials.")
			opts = append(opts, option.WithScopes(scopes...))
		}
	} else {
		opts = append(opts, option.WithScopes(scopes...))
	}

	directoryService, err := admin.NewService(ctx, opts...)
	if err != nil {
		log.Fatalf("Failed to initialize Admin SDK Directory client: %v", err)
	}

	// 4. Resolve Domain if not explicitly provided
	if domain == "" {
		log.Println("CLOUD_IDENTITY_DOMAIN not set. Attempting auto-detection via Directory API...")
		// Try to query the Directory API Domains List
		domainsResp, err := directoryService.Domains.List("my_customer").Do()
		if err == nil && len(domainsResp.Domains) > 0 {
			// Find primary domain or fallback to the first verified domain
			for _, d := range domainsResp.Domains {
				if d.IsPrimary {
					domain = d.DomainName
					log.Printf("Auto-detected primary domain: %s", domain)
					break
				}
			}
			if domain == "" {
				domain = domainsResp.Domains[0].DomainName
				log.Printf("Auto-detected fallback domain: %s", domain)
			}
		} else {
			// Failed to retrieve domains, fallback to project ID as a domain or default
			if err != nil {
				log.Printf("Warning: Domain auto-detection failed (%v).", err)
			} else {
				log.Println("Warning: No domains found in Google Workspace/Cloud Identity customer.")
			}
			
			if strings.Contains(projectID, ".") {
				domain = projectID
				log.Printf("Using project ID as domain (contains dot): %s", domain)
			} else {
				domain = projectID + ".com"
				log.Printf("Fallback: Using project-derived domain: %s", domain)
			}
		}
	} else {
		log.Printf("Using configured domain: %s", domain)
	}

	srv := &Server{
		config: Config{
			ProjectID:  projectID,
			Domain:     domain,
			Port:       port,
			AdminEmail: adminEmail,
		},
		crmService:       crmService,
		directoryService: directoryService,
	}

	// 5. Start HTTP server
	mux := http.NewServeMux()

	// API Routes
	mux.HandleFunc("GET /api/config", srv.handleGetConfig)
	mux.HandleFunc("POST /api/users", srv.handleCreateUser)
	mux.HandleFunc("DELETE /api/users", srv.handleDeleteUser)

	// Static files from ./public
	fileServer := http.FileServer(http.Dir("./public"))
	mux.Handle("/", srv.logRequest(fileServer))

	log.Printf("Labs server running on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// Logger middleware
func (s *Server) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// Config Handler
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.config)
}

type CreateUserRequest struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	ClientID string `json:"clientId"`
}

type CreateUserResponse struct {
	Name            string `json:"name"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	InitialPassword string `json:"initialPassword"`
	ConsoleURL      string `json:"consoleUrl"`
	ProjectID       string `json:"projectId"`
}

// Create User Handler
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(req.Name)
	username := strings.ToLower(strings.TrimSpace(req.Username))
	clientID := strings.TrimSpace(req.ClientID)

	if name == "" || username == "" {
		http.Error(w, `{"error": "Name and Username are required"}`, http.StatusBadRequest)
		return
	}

	email := fmt.Sprintf("%s@%s", username, s.config.Domain)
	ctx := r.Context()

	var finalEmail string
	var isNewUser bool

	// Query Google Directory API to check if user already exists in Google Cloud Identity
	log.Printf("Checking if user %s already exists in Cloud Identity...", email)
	u, err := s.directoryService.Users.Get(email).Context(ctx).Do()
	if err == nil {
		// User exists in Cloud Identity
		existingClientID := extractClientID(u.ExternalIds)
		if existingClientID != "" && existingClientID == clientID {
			log.Printf("User %s already exists in Cloud Identity, and the request Client ID matches the original creator ID (%s). Proceeding to role assignment.", email, clientID)
			finalEmail = u.PrimaryEmail
			isNewUser = false
		} else {
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": fmt.Sprintf("Username '%s' is already taken. Please choose another username.", username),
			})
			return
		}
	} else {
		// Check if the error is 404 Not Found
		if gErr, ok := err.(*googleapi.Error); ok && gErr.Code == http.StatusNotFound {
			isNewUser = true
		} else {
			log.Printf("Error checking user existence in Cloud Identity: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": fmt.Sprintf("Cloud Identity error checking existence: %v", err),
			})
			return
		}
	}

	// Set the default initial password to "aigateway"
	password := "aigateway"

	if isNewUser {
		// Split Name into Given and Family names
		parts := strings.Fields(name)
		givenName := name
		familyName := "User" // Fallback family name
		if len(parts) > 0 {
			givenName = parts[0]
			if len(parts) > 1 {
				familyName = strings.Join(parts[1:], " ")
			}
		}

		// Create user via Google Admin SDK Directory API
		newUser := &admin.User{
			PrimaryEmail: email,
			Name: &admin.UserName{
				GivenName:  givenName,
				FamilyName: familyName,
			},
			Password:                  password,
			ChangePasswordAtNextLogin: true,
			ExternalIds: []admin.UserExternalId{
				{Type: "custom", CustomType: "labs_client_id", Value: clientID},
			},
		}

		log.Printf("Creating user in Cloud Identity: %s", email)
		createdUser, err := s.directoryService.Users.Insert(newUser).Context(ctx).Do()
		if err != nil {
			log.Printf("Error creating user in Cloud Identity: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": fmt.Sprintf("Cloud Identity error: %v", err),
			})
			return
		}
		finalEmail = createdUser.PrimaryEmail
	}

	// Grant roles in the project via Resource Manager API with a robust retry loop
	// Recently created Cloud Identity users can take several seconds to propagate to GCP IAM.
	rolesToGrant := []string{"roles/apigee.admin", "roles/aiplatform.user"}
	member := "user:" + finalEmail
	projectResource := "projects/" + s.config.ProjectID

	var policyErr error
	maxRetries := 5
	backoff := 3 * time.Second

	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("Retrieving IAM policy for project: %s (attempt %d/%d)", s.config.ProjectID, attempt, maxRetries)
		policy, err := s.crmService.Projects.GetIamPolicy(projectResource, &cloudresourcemanager.GetIamPolicyRequest{}).Context(ctx).Do()
		if err != nil {
			policyErr = fmt.Errorf("failed to retrieve IAM policy: %w", err)
			log.Printf("Error getting IAM policy (attempt %d): %v", attempt, err)
			time.Sleep(backoff)
			continue
		}

		// Modify the IAM policy for each role
		for _, role := range rolesToGrant {
			bindingFound := false
			for _, binding := range policy.Bindings {
				if binding.Role == role {
					bindingFound = true
					memberFound := false
					for _, m := range binding.Members {
						if m == member {
							memberFound = true
							break
						}
					}
					if !memberFound {
						binding.Members = append(binding.Members, member)
					}
					break
				}
			}

			if !bindingFound {
				policy.Bindings = append(policy.Bindings, &cloudresourcemanager.Binding{
					Role:    role,
					Members: []string{member},
				})
			}
		}

		log.Printf("Updating IAM policy to grant roles %v to %s (attempt %d/%d)", rolesToGrant, member, attempt, maxRetries)
		_, err = s.crmService.Projects.SetIamPolicy(projectResource, &cloudresourcemanager.SetIamPolicyRequest{
			Policy: policy,
		}).Context(ctx).Do()
		if err == nil {
			// Success! Clear error and break retry loop
			policyErr = nil
			log.Printf("Successfully granted project roles to %s after %d attempt(s)", member, attempt)
			break
		}

		policyErr = fmt.Errorf("failed to set IAM policy: %w", err)
		log.Printf("Error setting IAM policy (attempt %d): %v. Retrying in %v...", attempt, err, backoff)
		time.Sleep(backoff)
	}

	if policyErr != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("User resolved/created successfully, but failed to grant project roles: %v", policyErr),
		})
		return
	}

	// Return success response
	consoleURL := fmt.Sprintf("https://console.cloud.google.com/?project=%s", s.config.ProjectID)
	response := CreateUserResponse{
		Name:            name,
		Username:        username,
		Email:           finalEmail,
		InitialPassword: password,
		ConsoleURL:      consoleURL,
		ProjectID:       s.config.ProjectID,
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(response)
	log.Printf("User successfully provisioned and configured: %s", email)
}

// Delete User Handler
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("username")))
	clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))

	if username == "" || clientID == "" {
		http.Error(w, `{"error": "username and clientId query parameters are required"}`, http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	email := fmt.Sprintf("%s@%s", username, s.config.Domain)

	log.Printf("Retrieving user %s from Cloud Identity to verify creator...", email)
	u, err := s.directoryService.Users.Get(email).Context(ctx).Do()
	if err != nil {
		// If user is not found in Cloud Identity, return 200 OK so browser cleans up locally
		if gErr, ok := err.(*googleapi.Error); ok && gErr.Code == http.StatusNotFound {
			log.Printf("User %s already deleted or not found in Cloud Identity. Returning success to client.", email)
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"message": fmt.Sprintf("User '%s' was successfully deleted.", username),
			})
			return
		}

		log.Printf("Error fetching user from Cloud Identity: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("Cloud Identity error: %v", err),
		})
		return
	}

	// Security Check: Only the original creator can delete the user
	existingClientID := extractClientID(u.ExternalIds)
	if existingClientID == "" || existingClientID != clientID {
		http.Error(w, `{"error": "You are not authorized to delete this user"}`, http.StatusForbidden)
		return
	}

	log.Printf("Deleting user %s from Cloud Identity...", email)
	err = s.directoryService.Users.Delete(email).Context(ctx).Do()
	if err != nil {
		log.Printf("Error deleting user from Cloud Identity: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("Cloud Identity error deleting user: %v", err),
		})
		return
	}

	log.Printf("Successfully deleted user %s from Cloud Identity", email)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("User '%s' was successfully deleted.", username),
	})
}

// extractClientID extracts our custom labs_client_id from user's ExternalIds field.
func extractClientID(externalIds interface{}) string {
	if externalIds == nil {
		return ""
	}
	// Marshal the interface{} to JSON and unmarshal into target struct slice to be 100% type-safe.
	data, err := json.Marshal(externalIds)
	if err != nil {
		return ""
	}
	var ids []admin.UserExternalId
	if err := json.Unmarshal(data, &ids); err != nil {
		return ""
	}
	for _, id := range ids {
		if id.Type == "custom" && id.CustomType == "labs_client_id" {
			return id.Value
		}
	}
	return ""
}


// generateRandomPassword generates a secure, randomized password meeting complexity rules
func generateRandomPassword() string {
	const (
		lower   = "abcdefghijklmnopqrstuvwxyz"
		upper   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		digits  = "0123456789"
		special = "!@#$%^*()-_=+[]{}|;:,.<>?"
	)

	// Use cryptographically secure numbers to select characters
	length := 14
	password := make([]byte, length)
	all := lower + upper + digits + special

	for i := 0; i < length; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(all))))
		if err != nil {
			log.Fatalf("Crypto rand failure: %v", err)
		}
		password[i] = all[num.Int64()]
	}

	// Ensure we meet strict complexity rules by injecting one from each category
	categories := []string{lower, upper, digits, special}
	for _, cat := range categories {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(length)))
		charIdx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(cat))))
		password[idx.Int64()] = cat[charIdx.Int64()]
	}

	return string(password)
}
