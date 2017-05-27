PERT.Node = class Node
{
    constructor(id, configStore, name)
    {
        this.id = id;
        this.config = configStore;
        const config = this.configData;
        if (!this.config.keys().length) {
            const nodes = PERT.currentProject.config.ns('nodes');
            const top = 200;
            let left = 400;
            for (const nodeId of nodes.keys()) {
                if (nodeId !== id) {
                    const nodeElement = document.getElementById(nodeId);
                    const node = nodes.get(nodeId);
                    left = Math.max(left, node.left + nodeElement.clientWidth + 20);
                }
            }
            Object.assign(config, {
                name,
                top,
                left,
                resources: {},
                critical: false,
                start: '',
                end: ''
            });
        }

        this.neighbours = {back: {}, forward: {}};

        const template = PERT.ui('templates').import.getElementById('NodeTemplate').content;
        const node = document.importNode(template, true).firstElementChild;
        this.node = node;

        node.id = id;
        node.style.top = `${config.top}px`;
        node.style.left = `${config.left}px`;
        if (config.critical) {
            node.classList.add('critical');
        }

        const input = node.querySelector('.node-name');
        const deleteButton = node.querySelector('.node-delete');
        const drag = node.querySelector('.node-drag');
        const critical = node.querySelector('.node-critical');
        const edgeLink = node.querySelector('.node-edge');
        this.dates = node.querySelectorAll('.node-dates input');

        input.value = config.name;
        if (!config.start) {
            this.dates[0].className = 'empty';
        }
        if (!config.end) {
            this.dates[1].className = 'empty';
        }
        this.dates[0].value = config.start;
        this.dates[1].value = config.end;

        PERT.ui('area').querySelector('.project-area').appendChild(node);

        this.update();

        input.addEventListener('change', e => {
            if (e.target.value === '') {
                alert('Milestone name cannot be empty.');
                e.target.value = config.name;
            } else {
                config.name = e.target.value;
            }
        });

        deleteButton.addEventListener('click', () => this.delete());

        drag.addEventListener('mousedown', e => {
            PERT.currentProject.moveNode = {
                top: e.clientY,
                left: e.clientX,
                originalTop: config.top,
                originalLeft: config.left,
                node,
                config,
                id
            };
            e.preventDefault();
        });

        node.addEventListener('dragover', e => {
            const originalId = e.dataTransfer.types.filter(v => v !== 'id' && v !== 'edgeid').pop();
            let element = e.target;
            while (element && !element.classList.contains('node')) {
                element = element.parentNode;
            }
            if (element && originalId === id) {
                return;
            }
            const edges = PERT.currentProject.config.get('edges');
            const loops = (from, direct) => {
                for (const edgeId in edges) {
                    const edge = edges[edgeId];
                    if (direct && edge.from === from && edge.to === id) {
                        return true;
                    } else if (direct && loops(id)) {
                        return true;
                    } else if (!direct && edge.from === from && (edge.to === originalId || loops(edge.to))) {
                        return true;
                    }
                }
                return false;
            };
            if (!loops(originalId, true)) {
                e.preventDefault();
            }
        });

        node.addEventListener('drop', e => {
            const from = e.dataTransfer.getData('id');
            const edgeId = e.dataTransfer.getData('edgeid');
            PERT.currentProject.config.ns('edges').set(edgeId, {from, to: id});
            PERT.currentProject.nodes[from].connect(edgeId, PERT.currentProject.nodes[id]);
        });

        critical.addEventListener('click', () => {
            if (config.critical) {
                node.classList.remove('critical');
                config.critical = false;
            } else {
                node.classList.add('critical');
                config.critical = true;
            }
            this.redrawEdges();
            PERT.currentProject.recaculateResourceConstraints();
        });

        edgeLink.addEventListener('dragstart', e => {
            const edgeId = PERT.currentProject.config.ns('edges').findFreeKey('e');
            e.dataTransfer.dropEffect = 'move';
            e.dataTransfer.setData(id, id);
            e.dataTransfer.setData('id', id);
            e.dataTransfer.setData('edgeid', edgeId);
            e.dataTransfer.setDragImage(new Image(), 0, 0);
            e.target.redrawEdge = (x, y) => {
                const edge = PERT.currentProject.nodes[id].createEdge(x, y, edgeId);
                edge.classList.add('edge-moving');
                if (!node.newedge) {
                    node.newedge = edge;
                    PERT.ui('area').querySelector('.project-area').appendChild(edge);
                }
            };
        });

        edgeLink.addEventListener('dragend', e => {
            e.dataTransfer.clearData();
            window.requestAnimationFrame(() => {
                if (!PERT.currentProject.config.ns('edges').has(node.newedge.id)) {
                    node.newedge.parentNode.removeChild(node.newedge);
                }
                node.newedge.classList.remove('edge-moving');
                delete node.newedge;
                delete node.redrawEdge;
            });
        });

        this.dates.forEach((node, index) => {
            const name = index ? 'end' : 'start';
            node.addEventListener('change', e => {
                config[name] = e.target.value;
                if (config[name]) {
                    e.target.classList.remove('empty');
                } else {
                    e.target.classList.add('empty');
                }
                PERT.currentProject.recalculateDateConstraints();
            });
        });
    }

    /**
     * @returns {Object}
     */
    get configData()
    {
        return this.config.getData();
    }

    delete()
    {
        if (!confirm('Are you sure you want to delete the selected milestone?')) {
            return;
        }
        this.node.parentNode.removeChild(this.node);

        for (const edgeId in this.neighbours.forward) {
            this.disconnect(edgeId);
        }
        for (const edgeId in this.neighbours.back) {
            this.neighbours.back[edgeId].disconnect(edgeId);
        }

        PERT.currentProject.deleteNode(this.id);
    }

    update()
    {
        const resources = this.node.querySelector('.node-resources');
        const nodeResources = this.config.get('resources');
        const config = PERT.currentProject.config.get('resources');

        resources.innerHTML = '';

        for (const resourceId in nodeResources) {
            if (!(resourceId in config)) {
                delete nodeResources[resourceId];
            }
        }

        const resourcesPerRow = Math.floor(((Object.keys(config).length || 1) - 1) / 3) + 1;
        let i = 0;
        let row = null;
        for (const resourceId in config) {
            if (!(resourceId in nodeResources)) {
                nodeResources[resourceId] = 0;
            }
            if (!(i++ % resourcesPerRow)) {
                row = document.createElement('tr');
                resources.appendChild(row);
            }
            const cell1 = document.createElement('td');
            const cell2 = cell1.cloneNode();

            cell1.innerText = config[resourceId].name;
            const input = document.createElement('input');
            input.value = nodeResources[resourceId];
            if (!nodeResources[resourceId]) {
                cell1.className = cell2.className = 'empty';
            }
            cell2.appendChild(input);

            row.appendChild(cell1);
            row.appendChild(cell2);

            input.addEventListener('change', e => {
                nodeResources[resourceId] = e.target.value = parseFloat(e.target.value) || 0;
                cell1.className = cell2.className = (e.target.value === '0' ? 'empty' : '');
                PERT.currentProject.recaculateResourceConstraints();
            });
        }
        PERT.currentProject.recaculateResourceConstraints();
    }

    /**
     * @param {Number} x2
     * @param {Number} y2
     * @param {String} [id]
     * @returns {HTMLDivElement}
     */
    createEdge(x2, y2, id)
    {
        const x1 = this.config.get('left') + this.node.clientWidth;
        const y1 = this.config.get('top') + this.node.clientHeight / 2;
        const edge = document.getElementById(id) || document.createElement('div');
        if (!edge.classList.contains('edge')) {
            edge.classList.add('edge');
            edge.id = id;
            edge.addEventListener('click', () => this.disconnect(id));
        }
        const dx = x2 - x1;
        const dy = y2 - y1;
        edge.style.top = `${y1}px`;
        edge.style.left = `${x1}px`;
        edge.style.width = `${Math.sqrt(dx*dx + dy*dy)}px`;
        edge.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        return edge;
    }

    /**
     * @param {String} id
     */
    drawEdge(id)
    {
        const node = this.neighbours.back[id] || this.neighbours.forward[id];
        const critcal1 = this.config.get('critical');
        const nodeConfig = node.configData;
        const yOffset2 = nodeConfig.top + node.node.clientHeight / 2;
        const edge = this.createEdge(nodeConfig.left, yOffset2, id);
        if (critcal1 && nodeConfig.critical && !edge.classList.contains('critical')) {
            edge.classList.add('critical');
        } else if (!(critcal1 && nodeConfig.critical) && edge.classList.contains('critical')) {
            edge.classList.remove('critical');
        }
        if (!edge.parentNode) {
            PERT.ui('area').querySelector('.project-area').appendChild(edge);
        }
    }

    redrawEdges()
    {
        for (const edgeId in this.neighbours.forward) {
            this.drawEdge(edgeId);
        }
        for (const edgeId in this.neighbours.back) {
            this.neighbours.back[edgeId].drawEdge(edgeId);
        }
    }

    /**
     * @param {String} id
     * @param {PERT.Node} node
     * @param {Boolean} [back=false]
     */
    connect(id, node, back)
    {
        if (back) {
            this.neighbours.back[id] = node;
        } else {
            this.neighbours.forward[id] = node;
            node.connect(id, this, true);
            this.drawEdge(id);
        }
    }

    /**
     * @param {String} id
     */
    disconnect(id)
    {
        if (id in this.neighbours.forward) {
            this.neighbours.forward[id].disconnect(id);
            delete this.neighbours.forward[id];
            PERT.currentProject.config.ns('edges').unset(id);
            const edge = document.getElementById(id);
            edge.parentNode.removeChild(edge);
        } else {
            delete this.neighbours.back[id];
        }
    }

    /**
     * @param {Boolean} [back=false]
     * @param {Boolean} [recursive=false]
     * @returns {PERT.Node[]}
     */
    getNeighbours(back, recursive)
    {
        const neighbours = [];
        const direction = back ? 'back' : 'forward';
        for (const edgeId in this.neighbours[direction]) {
            neighbours.push(this.neighbours[direction][edgeId]);
        }
        if (recursive) {
            return Array.from(
                new Set(
                    neighbours.concat(
                        ...neighbours.map(neighbour => neighbour.getNeighbours(back, recursive))
                    )
                )
            );
        }
        return neighbours;
    }

    /**
     * @param {Boolean} [back=false]
     * @param {String} [limit='']
     */
    updateDateConstraints(back, limit)
    {
        const neighbours = this.getNeighbours(back);
        const inputs = this.dates;
        const node = this.configData;
        if (back) {
            if (inputs[1].max && (!limit || inputs[1].max < limit)) {
                limit = inputs[1].max;
            }
            inputs[1].max = limit;
            inputs[0].max = this.node.end || inputs[1].max;
            limit = node.start || inputs[0].max;
        } else {
            if (inputs[0].min && (!limit || inputs[0].min > limit)) {
                limit = inputs[0].min;
            }
            inputs[0].min = limit;
            inputs[1].min = node.start || inputs[0].min;
            limit = node.end || inputs[1].min;
        }
        neighbours.forEach(neighbour => neighbour.updateDateConstraints(back, limit));
    }

    /**
     * @param {Boolean} [recursive=false]
     * @returns {Object}
     */
    cost(recursive)
    {
        let resourcesSpent = {};
        const resources = this.config.get('resources');
        for (const resourceId in resources) {
            resourcesSpent[resourceId] = resources[resourceId] || 0;
        }
        if (recursive) {
            const neighbours = this.getNeighbours(true, true);
            resourcesSpent = PERT.sumObjects(resourcesSpent, ...neighbours.map(node => node.cost()));
        }
        return resourcesSpent;
    }

    /**
     * @returns {Number}
     */
    level()
    {
        return this.getNeighbours(true)
            .reduce((max, nextNode) => Math.max(max, nextNode.level()), 0) + 1;
    }
};
