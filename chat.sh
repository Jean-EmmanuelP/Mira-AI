#!/bin/bash
# Chat avec Mira - Script interactif

GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

clear
echo -e "${PURPLE}"
echo "  __  __ _           "
echo " |  \/  (_)_ __ __ _ "
echo " | |\/| | | '__/ _\` |"
echo " | |  | | | | | (_| |"
echo " |_|  |_|_|_|  \__,_|"
echo -e "${NC}"
echo -e "${BLUE}Ton amie qui te connaît vraiment${NC}"
echo ""

# Demander le prénom
echo -ne "${PURPLE}Comment tu t'appelles ? ${NC}"
read -r USER_ID

if [ -z "$USER_ID" ]; then
    USER_ID="ami"
fi

echo ""
echo -e "${BLUE}Salut $USER_ID ! Tape 'quit' pour quitter.${NC}"
echo ""

while true; do
    echo -ne "${GREEN}$USER_ID: ${NC}"
    read -r message

    if [ "$message" = "quit" ] || [ "$message" = "exit" ] || [ "$message" = "q" ]; then
        echo -e "\n${PURPLE}À bientôt $USER_ID ! 👋${NC}\n"
        break
    fi

    if [ -z "$message" ]; then
        continue
    fi

    # Envoyer à Mira
    echo -ne "${PURPLE}Mira: ${NC}"

    response=$(curl -s -X POST http://localhost:3000/chat \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg u "$USER_ID" --arg m "$message" '{userId:$u,message:$m}')" \
        | jq -r '.response // "Erreur de connexion..."')

    echo -e "$response\n"
done
